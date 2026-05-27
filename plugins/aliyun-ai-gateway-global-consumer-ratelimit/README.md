# Aliyun AI Gateway Global Consumer RateLimit WASM Plugin

这是面向阿里云 AI 网关专享实例的自定义 WASM 插件示例。

插件职责保持很薄：

1. 从请求头读取 `tenant_id`、`consumer_id`。
2. 从请求头读取或兜底估算 `estimated_tokens`。
3. 调用内部 Quota Service 的 `/v1/ratelimit/reserve`。
4. Quota Service 返回允许时放行。
5. Quota Service 返回拒绝时直接返回 `429`。
6. 可选：在响应头阶段读取实际 token，并调用 `/v1/ratelimit/refund` 回补。

实际的全局 QPS/TPM 固定窗口和 Redis Lua 原子扣减由 Quota Service 执行。

## 为什么这样设计

阿里 AI 网关自定义插件运行在 WASM 环境内，适合做轻量请求拦截、Header/Body 处理和外部服务调用。全局限流状态、Redis Lua、配置中心、监控告警放在独立 Quota Service 中，发布和回滚会更稳。

```text
AI Gateway
  -> Consumer Auth
  -> global-consumer-ratelimit WASM plugin
      -> Quota Service
          -> Redis EVAL Lua
  -> Model API
```

## 编译

阿里官方文档要求 Go 1.24+，AI 网关版本不低于 `2.1.5`。

```bash
cd plugins/aliyun-ai-gateway-global-consumer-ratelimit
go mod tidy
GOOS=wasip1 GOARCH=wasm go build -buildmode=c-shared -o main.wasm ./
```

本机如果是 Windows PowerShell：

```powershell
$env:GOOS="wasip1"
$env:GOARCH="wasm"
go build -buildmode=c-shared -o main.wasm ./
```

## 阿里 AI 网关配置

控制台插件配置是 YAML，下发给插件后会转成 JSON。

示例：

```yaml
quotaService:
  serviceName: global-quota-service.dns
  servicePort: 8080
  reservePath: /v1/ratelimit/reserve
  refundPath: /v1/ratelimit/refund
  timeoutMs: 50

identity:
  tenantHeader: x-tenant-id
  consumerHeaders:
    - x-mse-consumer
    - x-consumer-id

token:
  estimatedTokensHeader: x-ai-estimated-tokens
  actualTokensHeader: x-ai-actual-tokens
  defaultEstimatedTokens: 1000
  refundEnabled: true

gatewayId: gw-prod
failOpen: false
```

Consumer identity is resolved from `identity.consumerHeaders` in order. The default is `x-mse-consumer` first, then `x-consumer-id` for dev curl testing or custom auth adapters.

## 部署位置

推荐安装为实例级插件规则，确保所有 Model API 共享同一套消费者全局额度。

执行顺序：

```text
Consumer Auth
  -> Global Consumer RateLimit
  -> Model API / AI Proxy
```

## Quota Service 接口约定

### Reserve

请求：

```json
{
  "gatewayId": "gw-prod",
  "tenantId": "tenant-a",
  "consumerId": "consumer-a",
  "estimatedTokens": 1200
}
```

允许：

```json
{
  "allowed": true,
  "reservationId": "opaque-id",
  "remaining": {
    "qps": 49,
    "tpm": 98800
  }
}
```

拒绝：

```json
{
  "allowed": false,
  "code": "GLOBAL_CONSUMER_RATE_LIMIT_EXCEEDED",
  "limitType": "tpm",
  "retryAfterSeconds": 12
}
```

### Refund

请求：

```json
{
  "reservationId": "opaque-id",
  "actualTokens": 700
}
```
