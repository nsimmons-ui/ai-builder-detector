import { detectUrl } from "../_detector";

export const onRequestGet: PagesFunction = async (ctx) => {
  const url = new URL(ctx.request.url).searchParams.get("url");

  if (!url) {
    return Response.json({ error: "Missing ?url= parameter" }, { status: 400 });
  }

  try {
    const result = await detectUrl(url);
    return Response.json(result, {
      headers: { "Access-Control-Allow-Origin": "*" },
    });
  } catch (err: unknown) {
    return Response.json(
      { error: err instanceof Error ? err.message : "Unknown error" },
      { status: 500 },
    );
  }
};

export const onRequestOptions: PagesFunction = async () => {
  return new Response(null, {
    headers: {
      "Access-Control-Allow-Origin": "*",
      "Access-Control-Allow-Methods": "GET, OPTIONS",
    },
  });
};
