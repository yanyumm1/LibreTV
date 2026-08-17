// functions/img-proxy/[[path]].js
// 免鉴权图片代理：仅供图片使用，不校验任何密码/auth
// 用法: /img-proxy/<encodeURIComponent(图片URL)>
// 对比 /proxy/ 区别：
//   - 不校验 auth 参数（图片是公开资源，不能每次带密码）
//   - 自动带 Referer 反防盗链（豆瓣图等需要 Referer 才能看）
//   - 只代理图片类资源，视频/直播不可用它（防滥用）

const IMG_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.bmp', '.tiff', '.svg', '.avif', '.heic', '.ico'];
const IMG_CONTENT_TYPES = ['image/'];

export async function onRequest(context) {
    const { request, env } = context;
    const url = new URL(request.url);

    // 只允许 GET/HEAD
    if (request.method !== 'GET' && request.method !== 'HEAD') {
        return new Response(JSON.stringify({ success: false, error: '仅支持 GET/HEAD' }), {
            status: 405,
            headers: corsHeaders('application/json')
        });
    }

    // 从路径提取目标图片 URL
    const targetUrl = getTargetUrl(url.pathname);
    if (!targetUrl) {
        return new Response(JSON.stringify({ success: false, error: '无效的图片 URL。路径应为 /img-proxy/<encodeURIComponent(url)>' }), {
            status: 400,
            headers: corsHeaders('application/json')
        });
    }

    // 只放行 http(s)
    if (!/^https?:\/\//i.test(targetUrl)) {
        return new Response(JSON.stringify({ success: false, error: '只允许 http/https 图片' }), {
            status: 400,
            headers: corsHeaders('application/json')
        });
    }

    // 从环境变量读取是否强制 Referer（默认豆瓣）
    const refererForImg = env.IMG_REFERER || 'https://movie.douban.com/';

    const fetchHeaders = new Headers({
        'User-Agent': getRandomUserAgent(),
        'Accept': 'image/avif,image/webp,image/apng,image/*,*/*;q=0.8',
        'Referer': refererForImg,
    });

    try {
        const upstream = await fetch(targetUrl, {
            headers: fetchHeaders,
            redirect: 'follow',
            // Cloudflare 默认会代理，这里不设 cf 特殊选项
        });

        if (!upstream.ok) {
            return new Response(JSON.stringify({ success: false, error: `上游图片返回 ${upstream.status}` }), {
                status: upstream.status,
                headers: corsHeaders('application/json')
            });
        }

        const contentType = upstream.headers.get('content-type') || 'image/jpeg';

        // 拼接响应头
        const outHeaders = new Headers(corsHeaders(''));
        outHeaders.set('Content-Type', contentType);
        // 长缓存：图片不常变，CDN 缓存 1 天（对封面可接受）
        outHeaders.set('Cache-Control', `public, max-age=${env.IMG_CACHE_TTL || 86400}`);
        // 透传 CORS，保证前端 <img> 和 fetch 都能用
        outHeaders.set('Access-Control-Allow-Origin', '*');
        outHeaders.set('Access-Control-Allow-Methods', 'GET, HEAD, OPTIONS');
        outHeaders.set('Access-Control-Allow-Headers', '*');

        // 原样返回图片 body（stream 更高效）
        return new Response(upstream.body, {
            status: 200,
            headers: outHeaders,
        });
    } catch (e) {
        return new Response(JSON.stringify({ success: false, error: `代理图片失败: ${e.message}` }), {
            status: 502,
            headers: corsHeaders('application/json')
        });
    }
}

export async function onOptions(context) {
    return new Response(null, {
        status: 204,
        headers: corsHeaders(''),
    });
}

// --- 辅助 ---
function getTargetUrl(pathname) {
    const encoded = pathname.replace(/^\/img-proxy\//, '');
    if (!encoded) return null;
    try {
        let decoded = decodeURIComponent(encoded);
        if (!/^https?:\/\//i.test(decoded)) {
            // 可能没编码直接传了 URL
            if (encoded.match(/^https?:\/\//i)) {
                decoded = encoded;
            } else {
                return null;
            }
        }
        return decoded;
    } catch (e) {
        return null;
    }
}

function corsHeaders(contentType = '') {
    const h = {
        'Access-Control-Allow-Origin': '*',
        'Access-Control-Allow-Methods': 'GET, HEAD, OPTIONS',
        'Access-Control-Allow-Headers': '*',
    };
    if (contentType) h['Content-Type'] = contentType;
    return h;
}

function getRandomUserAgent() {
    const agents = [
        'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/120.0.0.0 Safari/537.36',
        'Mozilla/5.0 (iPhone; CPU iPhone OS 16_5 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/16.5 Mobile/15E148 Safari/604.1',
        'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/119.0.0.0 Safari/537.36',
        'Mozilla/5.0 (X11; Linux x86_64; rv:109.0) Gecko/20100101 Firefox/119.0',
    ];
    return agents[Math.floor(Math.random() * agents.length)];
}