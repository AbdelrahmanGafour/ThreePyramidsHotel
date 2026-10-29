export async function register() {
  if (process.env.NEXT_RUNTIME !== "nodejs") return;

  const { installEmbeddedApi } = await import("./shared/server/embeddedApi");
  await installEmbeddedApi();
}
