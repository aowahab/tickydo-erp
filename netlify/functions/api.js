import serverless from 'serverless-http';

let proxyPromise;

export async function handler(event, context) {
    process.env.NETLIFY_FUNCTION = 'true';
    proxyPromise ??= import('../../server.js').then(({ default: app }) =>
        serverless(app, { basePath: '/.netlify/functions/api' })
    );
    return (await proxyPromise)(event, context);
}
