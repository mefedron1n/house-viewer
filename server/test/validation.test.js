import test from "node:test";
import assert from "node:assert/strict";
import { extractMetadata, isIfc, validUploadPassword } from "../index.js";
test("accepts STEP IFC header", () => assert.equal(isIfc(Buffer.from("ISO-10303-21;\nHEADER;\nFILE_SCHEMA(('IFC4'));\nENDSEC;")), true));
test("rejects non-IFC content", () => assert.equal(isIfc(Buffer.from("not an IFC")), false));
test("extracts IFC space metadata", () => { const result = extractMetadata("#1=IFCSPACE('spaceId',$,'Living room',$,$,$,$,$,$,$,$);"); assert.equal(result.elements.spaceId.type, "IfcSpace"); });
test("checks the upload password", () => { assert.equal(validUploadPassword("test123"), true); assert.equal(validUploadPassword("wrong"), false); });
