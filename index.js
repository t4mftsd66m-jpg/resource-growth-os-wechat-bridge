const https = require('https');
const express = require('express');

const app = express();
const port = Number(process.env.PORT || 80);
const maxBodyBytes = 128 * 1024;
const upstreamWebhookUrl = process.env.UPSTREAM_WEBHOOK_URL;

app.use('/api/wechat/webhook', express.raw({ type: '*/*', limit: maxBodyBytes }));

function forwardToResourceGrowthOS(request) {
  if (!upstreamWebhookUrl) {
    return Promise.resolve({ status: 503, headers: { 'content-type': 'text/plain; charset=utf-8' }, body: Buffer.from('bridge configuration missing') });
  }

  const target = new URL(upstreamWebhookUrl);
  const incoming = new URL(request.originalUrl, 'https://bridge.invalid');
  target.search = incoming.search;

  return new Promise((resolve, reject) => {
    const body = ['GET', 'HEAD'].includes(request.method) ? null : request.body;
    const upstreamRequest = https.request(target, {
      method: request.method,
      headers: {
        'content-type': request.get('content-type') || 'application/xml; charset=utf-8',
        'content-length': body ? Buffer.byteLength(body) : 0,
        'user-agent': 'Resource-Growth-OS-WeChat-Bridge/1.0'
      },
      timeout: 8000
    }, (upstreamResponse) => {
      const chunks = [];
      upstreamResponse.on('data', (chunk) => chunks.push(chunk));
      upstreamResponse.on('end', () => resolve({
        status: upstreamResponse.statusCode || 502,
        headers: upstreamResponse.headers,
        body: Buffer.concat(chunks)
      }));
    });

    upstreamRequest.on('timeout', () => upstreamRequest.destroy(new Error('upstream timeout')));
    upstreamRequest.on('error', reject);
    if (body) upstreamRequest.write(body);
    upstreamRequest.end();
  });
}

async function webhook(request, response) {
  try {
    const upstreamResponse = await forwardToResourceGrowthOS(request);
    response.status(upstreamResponse.status)
      .set('content-type', upstreamResponse.headers['content-type'] || 'text/plain; charset=utf-8')
      .set('cache-control', 'no-store')
      .send(upstreamResponse.body);
  } catch (error) {
    console.error('wechat_webhook_bridge_upstream_failed', error instanceof Error ? error.message : 'unknown_error');
    response.status(502).type('text/plain').send('upstream unavailable');
  }
}

app.get('/api/wechat/webhook', webhook);
app.post('/api/wechat/webhook', webhook);
app.get('/healthz', (_request, response) => response.status(200).json({ status: 'ok' }));
app.use((_request, response) => response.status(404).type('text/plain').send('Not Found'));

app.listen(port, '0.0.0.0', () => console.log(`wechat webhook bridge listening on ${port}`));
