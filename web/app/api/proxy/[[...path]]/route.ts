import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL =
  process.env.FASTAPI_BACKEND_URL ||
  process.env.BACKEND_API_URL ||
  "http://127.0.0.1:8001";

async function proxyRequest(request: NextRequest, rawParams: Promise<{ path?: string[] }>) {
  const params = await rawParams;
  const subpath = params.path && params.path.length > 0 ? params.path.join("/") : "";
  const search = request.nextUrl.search;
  const targetUrl = `${BACKEND_URL}/${subpath}${search}`;

  const headers = new Headers();
  request.headers.forEach((value, key) => {
    const lower = key.toLowerCase();
    if (!["host", "connection", "transfer-encoding"].includes(lower)) {
      headers.set(key, value);
    }
  });

  try {
    let body: BodyInit | undefined = undefined;
    if (request.method !== "GET" && request.method !== "HEAD") {
      const buffer = await request.arrayBuffer();
      if (buffer.byteLength > 0) {
        body = buffer;
      }
    }

    const response = await fetch(targetUrl, {
      method: request.method,
      headers,
      body,
      cache: "no-store",
    });

    const responseBuffer = await response.arrayBuffer();
    const responseHeaders = new Headers();
    response.headers.forEach((value, key) => {
      const lower = key.toLowerCase();
      if (!["content-encoding", "transfer-encoding", "content-length"].includes(lower)) {
        responseHeaders.set(key, value);
      }
    });

    return new NextResponse(responseBuffer, {
      status: response.status,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error(`[Proxy Error] Failed to proxy ${request.method} to ${targetUrl}:`, err);
    return NextResponse.json(
      {
        detail: "FastAPI server is offline or unreachable on port 8001.",
        target: targetUrl,
      },
      { status: 502 }
    );
  }
}

export async function GET(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  return proxyRequest(request, context.params);
}

export async function POST(
  request: NextRequest,
  context: { params: Promise<{ path?: string[] }> }
) {
  return proxyRequest(request, context.params);
}

export async function OPTIONS() {
  return new NextResponse(null, {
    status: 204,
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, POST, OPTIONS",
      "Access-Control-Allow-Headers": "*",
    },
  });
}
