import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs/promises";
import os from "node:os";
import path from "node:path";
import { extractMetadata, isIfc, validUploadPassword } from "../index.js";
import { normalizeImage, validateGlbFile, validateIfcFile } from "../file-validation.js";
test("accepts STEP IFC header", () =>
  assert.equal(
    isIfc(Buffer.from("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;")),
    true
  ));
test("rejects non-IFC content", () => assert.equal(isIfc(Buffer.from("not an IFC")), false));
test("extracts IFC space metadata", () => {
  const result = extractMetadata("#1=IFCSPACE('spaceId',$,'Living room',$,$,$,$,$,$,$,$);");
  assert.equal(result.elements.spaceId.type, "IfcSpace");
});
test("rejects uploads when no password is configured", () => {
  assert.equal(validUploadPassword(""), false);
  assert.equal(validUploadPassword("wrong"), false);
});
test("rejects malformed GLB structure and unsupported image bytes", async () => {
  const directory = await fs.mkdtemp(path.join(os.tmpdir(), "house-validation-")),
    glb = path.join(directory, "bad.glb"),
    ifc = path.join(directory, "bad.ifc");
  try {
    await fs.writeFile(glb, Buffer.from("glTF\u0002\u0000\u0000\u00009999"));
    await fs.writeFile(ifc, "ISO-10303-21;\nHEADER;\nENDSEC;");
    assert.equal(await validateGlbFile(glb), false);
    assert.equal(await validateIfcFile(ifc), false);
    await assert.rejects(() =>
      normalizeImage(ifc, path.join(directory, "image.png"), {
        maxWidth: 100,
        maxHeight: 100,
        maxPixels: 10000,
      })
    );
  } finally {
    await fs.rm(directory, { recursive: true, force: true });
  }
});
