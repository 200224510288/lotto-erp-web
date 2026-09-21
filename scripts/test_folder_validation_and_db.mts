// scripts/test_folder_validation_and_db.mts
import fs from "fs";

async function run() {
  console.log("=== 1. TESTING NON-EXISTENT FOLDER VALIDATION (FILE NOT FOUND) ===");
  const fakeFolder = "C:\\fake_non_existent_folder_12345";
  if (fs.existsSync(fakeFolder)) {
    fs.rmdirSync(fakeFolder);
  }

  // Test GET on non-existent folder
  const getRes = await fetch(
    `http://localhost:3000/api/nlb-return-save-local?folder=${encodeURIComponent(fakeFolder)}`
  );
  const getJson = await getRes.json();
  console.log("GET non-existent folder response status:", getRes.status);
  console.log("GET non-existent folder response body:", getJson);

  if (getRes.status !== 404 || !getJson.error?.includes("File not found")) {
    console.error("FAIL: GET did not return 404 with 'File not found' error!");
    process.exit(1);
  }
  if (fs.existsSync(fakeFolder)) {
    console.error("FAIL: GET auto-created the folder instead of validating existence!");
    process.exit(1);
  }
  console.log("✓ GET correctly returned 404 File not found and did NOT create folder.");

  // Test POST on non-existent folder
  const dummyBlob = new Blob(["dummy"], { type: "application/octet-stream" });
  const postRes = await fetch(
    `http://localhost:3000/api/nlb-return-save-local?filename=fake.xlsx&folder=${encodeURIComponent(fakeFolder)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: dummyBlob,
    }
  );
  const postJson = await postRes.json();
  console.log("POST non-existent folder response status:", postRes.status);
  console.log("POST non-existent folder response body:", postJson);

  if (postRes.status !== 404 || !postJson.error?.includes("File not found")) {
    console.error("FAIL: POST did not return 404 with 'File not found' error!");
    process.exit(1);
  }
  if (fs.existsSync(fakeFolder)) {
    console.error("FAIL: POST auto-created the folder instead of validating existence!");
    process.exit(1);
  }
  console.log("✓ POST correctly returned 404 File not found and did NOT create folder.");

  console.log("\n=== 2. TESTING VALID LOCAL SAVE & DB PERSISTENCE ===");
  const testFile = "TEST_VALID_SAVE.xlsx";
  const validPostRes = await fetch(
    `http://localhost:3000/api/nlb-return-save-local?filename=${encodeURIComponent(testFile)}`,
    {
      method: "POST",
      headers: { "Content-Type": "application/octet-stream" },
      body: dummyBlob,
    }
  );
  const validJson = await validPostRes.json();
  console.log("POST valid save response:", validJson);

  if (!validPostRes.ok || !validJson.success) {
    console.error("FAIL: POST valid save failed!");
    process.exit(1);
  }

  const expectedPath = "C:\\nlb return\\" + testFile;
  if (fs.existsSync(expectedPath)) {
    console.log(`✓ File verified written to disk at: ${expectedPath}`);
    fs.unlinkSync(expectedPath);
    console.log("✓ Cleaned up test file.");
  } else {
    console.error(`FAIL: File not found at expected disk location: ${expectedPath}`);
    process.exit(1);
  }

  console.log("\n=== 3. TESTING GET STATUS OF C:\\nlb return ===");
  const statusRes = await fetch("http://localhost:3000/api/nlb-return-save-local");
  const statusJson = await statusRes.json();
  console.log("GET real folder status:", statusJson);
  if (!statusRes.ok || !statusJson.success || !statusJson.exists) {
    console.error("FAIL: GET real folder status failed!");
    process.exit(1);
  }
  console.log(`✓ Real folder verified with ${statusJson.fileCount} file(s).`);

  console.log("\nALL TESTS PASSED SUCCESSFULLY! ✓✓✓");
}

run().catch((err) => {
  console.error("Test error:", err);
  process.exit(1);
});
