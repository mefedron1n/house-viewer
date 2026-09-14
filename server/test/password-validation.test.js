import test from "node:test";
import assert from "node:assert/strict";

test("action password can be validated without changing data", async () => {
  process.env.UPLOAD_PASSWORD = "пароль проверки";
  const { app } = await import(`../index.js?password-validation=${Date.now()}`);
  const server = app.listen(0, "127.0.0.1");
  await new Promise((resolve) => server.once("listening", resolve));
  const base = `http://127.0.0.1:${server.address().port}`;
  try {
    const invalid = await fetch(`${base}/api/upload-password/validate`, {
      method: "POST",
      headers: { "X-Upload-Password": "wrong" },
    });
    assert.equal(invalid.status, 401);

    const valid = await fetch(`${base}/api/upload-password/validate`, {
      method: "POST",
      headers: {
        "X-Upload-Password": `roomark-uri:${encodeURIComponent("пароль проверки")}`,
      },
    });
    assert.equal(valid.status, 204);
    assert.equal(await valid.text(), "");
  } finally {
    server.close();
  }
});
