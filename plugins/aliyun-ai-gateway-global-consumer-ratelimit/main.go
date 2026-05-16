package main

import (
	"encoding/json"
	"errors"
	"net/http"
	"strconv"
	"strings"

	"github.com/higress-group/proxy-wasm-go-sdk/proxywasm"
	"github.com/higress-group/proxy-wasm-go-sdk/proxywasm/types"
	logs "github.com/higress-group/wasm-go/pkg/log"
	"github.com/higress-group/wasm-go/pkg/wrapper"
	"github.com/tidwall/gjson"
)

const (
	contextReservationID = "global_consumer_ratelimit_reservation_id"
)

func main() {}

func init() {
	wrapper.SetCtx(
		"global-consumer-ratelimit",
		wrapper.ParseConfigBy(parseConfig),
		wrapper.ProcessRequestHeadersBy(onHttpRequestHeaders),
		wrapper.ProcessResponseHeadersBy(onHttpResponseHeaders),
	)
}

type PluginConfig struct {
	client wrapper.HttpClient

	gatewayID string
	failOpen  bool

	reservePath string
	refundPath  string
	timeoutMs   uint32

	tenantHeader   string
	consumerHeader string

	estimatedTokensHeader string
	actualTokensHeader    string
	defaultEstimatedTokens int64
	refundEnabled         bool
}

type reserveRequest struct {
	GatewayID       string `json:"gatewayId"`
	TenantID        string `json:"tenantId"`
	ConsumerID      string `json:"consumerId"`
	EstimatedTokens int64  `json:"estimatedTokens"`
}

type refundRequest struct {
	ReservationID string `json:"reservationId"`
	ActualTokens  int64  `json:"actualTokens"`
}

func parseConfig(jsonResult gjson.Result, config *PluginConfig, log logs.Log) error {
	serviceName := strings.TrimSpace(jsonResult.Get("quotaService.serviceName").String())
	if serviceName == "" {
		return errors.New("missing quotaService.serviceName")
	}

	servicePort := jsonResult.Get("quotaService.servicePort").Int()
	if servicePort == 0 {
		if strings.HasSuffix(serviceName, ".static") {
			servicePort = 80
		} else {
			servicePort = 8080
		}
	}

	config.client = wrapper.NewClusterClient(wrapper.FQDNCluster{
		FQDN: serviceName,
		Port: servicePort,
	})

	config.gatewayID = defaultString(jsonResult.Get("gatewayId").String(), "default")
	config.failOpen = jsonResult.Get("failOpen").Bool()

	config.reservePath = defaultString(jsonResult.Get("quotaService.reservePath").String(), "/v1/ratelimit/reserve")
	config.refundPath = defaultString(jsonResult.Get("quotaService.refundPath").String(), "/v1/ratelimit/refund")

	timeoutMs := jsonResult.Get("quotaService.timeoutMs").Uint()
	if timeoutMs == 0 {
		timeoutMs = 50
	}
	config.timeoutMs = uint32(timeoutMs)

	config.tenantHeader = defaultString(jsonResult.Get("identity.tenantHeader").String(), "x-tenant-id")
	config.consumerHeader = defaultString(jsonResult.Get("identity.consumerHeader").String(), "x-consumer-id")

	config.estimatedTokensHeader = defaultString(jsonResult.Get("token.estimatedTokensHeader").String(), "x-ai-estimated-tokens")
	config.actualTokensHeader = defaultString(jsonResult.Get("token.actualTokensHeader").String(), "x-ai-actual-tokens")

	defaultEstimatedTokens := jsonResult.Get("token.defaultEstimatedTokens").Int()
	if defaultEstimatedTokens <= 0 {
		defaultEstimatedTokens = 1000
	}
	config.defaultEstimatedTokens = defaultEstimatedTokens
	config.refundEnabled = jsonResult.Get("token.refundEnabled").Bool()

	log.Infof("global consumer ratelimit plugin configured, quotaService=%s:%d, reservePath=%s", serviceName, servicePort, config.reservePath)
	return nil
}

func onHttpRequestHeaders(ctx wrapper.HttpContext, config PluginConfig, log logs.Log) types.Action {
	tenantID := readHeader(config.tenantHeader)
	consumerID := readHeader(config.consumerHeader)
	if consumerID == "" {
		return handlePluginFailure(config, log, "missing consumer header: "+config.consumerHeader)
	}
	if tenantID == "" {
		tenantID = "*"
	}

	estimatedTokens := parsePositiveInt64(readHeader(config.estimatedTokensHeader), config.defaultEstimatedTokens)
	body, err := json.Marshal(reserveRequest{
		GatewayID:       config.gatewayID,
		TenantID:        tenantID,
		ConsumerID:      consumerID,
		EstimatedTokens: estimatedTokens,
	})
	if err != nil {
		return handlePluginFailure(config, log, "marshal reserve request failed: "+err.Error())
	}

	err = config.client.Post(
		config.reservePath,
		[][2]string{{"content-type", "application/json"}},
		body,
		func(statusCode int, responseHeaders http.Header, responseBody []byte) {
			handleReserveResponse(ctx, config, log, statusCode, responseBody)
		},
		config.timeoutMs,
	)
	if err != nil {
		return handlePluginFailure(config, log, "quota reserve call failed: "+err.Error())
	}

	return types.HeaderStopAllIterationAndWatermark
}

func handleReserveResponse(ctx wrapper.HttpContext, config PluginConfig, log logs.Log, statusCode int, responseBody []byte) {
	if statusCode != http.StatusOK {
		if config.failOpen {
			log.Errorf("quota reserve returned %d, fail open", statusCode)
			proxywasm.ResumeHttpRequest()
			return
		}
		sendUnavailable("quota service unavailable")
		return
	}

	result := gjson.ParseBytes(responseBody)
	if result.Get("allowed").Bool() {
		reservationID := result.Get("reservationId").String()
		if reservationID != "" {
			ctx.SetContext(contextReservationID, reservationID)
			proxywasm.AddHttpRequestHeader("x-ai-global-ratelimit-reservation-id", reservationID)
		}

		addRemainingHeaders(result)
		proxywasm.ResumeHttpRequest()
		return
	}

	limitType := defaultString(result.Get("limitType").String(), "unknown")
	retryAfter := result.Get("retryAfterSeconds").Int()
	if retryAfter <= 0 {
		retryAfter = 1
	}

	body := `{"error":{"code":"GLOBAL_CONSUMER_RATE_LIMIT_EXCEEDED","message":"Global consumer rate limit exceeded","type":"rate_limit_error","limit_type":"` + limitType + `","retry_after":` + strconv.FormatInt(retryAfter, 10) + `}}`
	headers := [][2]string{
		{"content-type", "application/json"},
		{"retry-after", strconv.FormatInt(retryAfter, 10)},
		{"x-ratelimit-scope", "global_consumer"},
		{"x-ratelimit-limit-type", limitType},
	}
	proxywasm.SendHttpResponse(http.StatusTooManyRequests, headers, []byte(body), -1)
}

func onHttpResponseHeaders(ctx wrapper.HttpContext, config PluginConfig, log logs.Log) types.Action {
	if !config.refundEnabled {
		return types.HeaderContinue
	}

	value := ctx.GetContext(contextReservationID)
	if value == nil {
		return types.HeaderContinue
	}

	reservationID, ok := value.(string)
	if !ok || reservationID == "" {
		return types.HeaderContinue
	}

	actualTokens := parsePositiveInt64(readResponseHeader(config.actualTokensHeader), -1)
	if actualTokens < 0 {
		return types.HeaderContinue
	}

	body, err := json.Marshal(refundRequest{
		ReservationID: reservationID,
		ActualTokens:  actualTokens,
	})
	if err != nil {
		log.Errorf("marshal refund request failed: %v", err)
		return types.HeaderContinue
	}

	err = config.client.Post(
		config.refundPath,
		[][2]string{{"content-type", "application/json"}},
		body,
		func(statusCode int, responseHeaders http.Header, responseBody []byte) {
			if statusCode != http.StatusOK {
				log.Errorf("quota refund returned %d: %s", statusCode, responseBody)
			}
			proxywasm.ResumeHttpResponse()
		},
		config.timeoutMs,
	)
	if err != nil {
		log.Errorf("quota refund call failed: %v", err)
		return types.HeaderContinue
	}

	return types.HeaderStopAllIterationAndWatermark
}

func addRemainingHeaders(result gjson.Result) {
	if value := result.Get("remaining.qps"); value.Exists() {
		proxywasm.AddHttpRequestHeader("x-ai-global-ratelimit-remaining-qps", value.String())
	}
	if value := result.Get("remaining.tpm"); value.Exists() {
		proxywasm.AddHttpRequestHeader("x-ai-global-ratelimit-remaining-tpm", value.String())
	}
}

func handlePluginFailure(config PluginConfig, log logs.Log, message string) types.Action {
	log.Errorf(message)
	if config.failOpen {
		return types.HeaderContinue
	}
	sendUnavailable(message)
	return types.HeaderContinue
}

func sendUnavailable(message string) {
	body := `{"error":{"code":"GLOBAL_CONSUMER_RATELIMIT_UNAVAILABLE","message":"` + escapeJSON(message) + `","type":"rate_limit_error"}}`
	proxywasm.SendHttpResponse(
		http.StatusServiceUnavailable,
		[][2]string{{"content-type", "application/json"}},
		[]byte(body),
		-1,
	)
}

func readHeader(name string) string {
	value, err := proxywasm.GetHttpRequestHeader(name)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

func readResponseHeader(name string) string {
	value, err := proxywasm.GetHttpResponseHeader(name)
	if err != nil {
		return ""
	}
	return strings.TrimSpace(value)
}

func defaultString(value string, fallback string) string {
	value = strings.TrimSpace(value)
	if value == "" {
		return fallback
	}
	return value
}

func parsePositiveInt64(value string, fallback int64) int64 {
	if value == "" {
		return fallback
	}
	parsed, err := strconv.ParseInt(strings.TrimSpace(value), 10, 64)
	if err != nil || parsed < 0 {
		return fallback
	}
	return parsed
}

func escapeJSON(value string) string {
	encoded, err := json.Marshal(value)
	if err != nil {
		return "internal error"
	}
	return strings.Trim(string(encoded), `"`)
}
