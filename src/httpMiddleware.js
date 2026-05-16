'use strict';

function createGlobalConsumerRateLimitMiddleware(rateLimiter, options = {}) {
  const estimateTokens = options.estimateTokens || defaultEstimateTokens;
  const readActualTokens = options.readActualTokens || defaultReadActualTokens;

  return function globalConsumerRateLimit(req, res, next) {
    const consumer = req.consumer || {};
    const check = rateLimiter.checkRequestAsync || rateLimiter.checkRequest.bind(rateLimiter);
    const complete = rateLimiter.completeRequestAsync || rateLimiter.completeRequest.bind(rateLimiter);

    Promise.resolve(check.call(rateLimiter, {
      tenantId: consumer.tenantId,
      consumerId: consumer.consumerId,
      estimatedTokens: estimateTokens(req)
    })).then((result) => {
      if (!result.allowed) {
        writeRateLimitResponse(res, result);
        return;
      }

      res.on('finish', () => {
        Promise.resolve(complete.call(rateLimiter, {
          reservation: result.reservation,
          actualTokens: readActualTokens(req, res)
        })).catch((error) => {
          if (options.onError) {
            options.onError(error, req);
          }
        });
      });

      req.globalConsumerRateLimit = result;
      next();
    }).catch(next);
  };
}

function writeRateLimitResponse(res, result) {
  res.statusCode = 429;
  res.setHeader('Content-Type', 'application/json');
  res.setHeader('Retry-After', String(result.retryAfterSeconds));
  res.setHeader('X-RateLimit-Scope', 'global_consumer');
  res.setHeader('X-RateLimit-Limit-QPS', String(result.limits.qps ?? -1));
  res.setHeader('X-RateLimit-Limit-TPM', String(result.limits.tpm ?? -1));
  res.setHeader('X-RateLimit-Remaining-QPS', String(result.remaining.qps ?? -1));
  res.setHeader('X-RateLimit-Remaining-TPM', String(result.remaining.tpm ?? -1));

  res.end(JSON.stringify({
    error: {
      code: result.code,
      message: result.message,
      type: 'rate_limit_error',
      limit_type: result.limitType,
      consumer_id: result.consumerId,
      retry_after: result.retryAfterSeconds
    }
  }));
}

function defaultEstimateTokens(req) {
  const body = req.body || {};
  const promptTokens = Number(body.prompt_tokens || body.estimated_prompt_tokens || 0);
  const maxCompletionTokens = Number(body.max_tokens || body.max_completion_tokens || 0);
  return Math.max(promptTokens, 0) + Math.max(maxCompletionTokens, 0);
}

function defaultReadActualTokens(req, res) {
  return Number(res.locals?.aiUsage?.total_tokens || req.aiUsage?.total_tokens || 0);
}

module.exports = {
  createGlobalConsumerRateLimitMiddleware,
  writeRateLimitResponse,
  defaultEstimateTokens,
  defaultReadActualTokens
};
