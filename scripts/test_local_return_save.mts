// scripts/test_local_return_save.mts
import fs from "fs";

async function run() {
  console.log("=== TESTING LOCAL SAVE TO C:\\nlb return ===");

  const dummyContent = "Test Return Excel Buffer";
  const blob = new Blob([dummyContent], { type: "application/octet-stream" });

  const res = await fetch("http://localhost:3000/api/nlb-return-save-local?filename=TEST_RETURN.xlsx", {
    method: "POST",
    headers: {
      "Content-Type": "application/octet-stream",
    },
    body: blob,
  });

  const json = await res.json();
  console.log("API Response:", json);

  if (res.ok && json.success) {
    console.log("✓ API returned success");
    const targetPath = "C:\\nlb return\\TEST_RETURN.xlsx";
    if (fs.existsSync(targetPath)) {
      console.log(`✓ File verified on disk at: ${targetPath}`);
      // Clean up test file
      fs.unlinkSync(targetPath);
      console.log("✓ Cleaned up test file.");
      console.log("TEST PASSED SUCCESSFULLY!");
    } else {
      console.error(`✗ File does not exist at ${targetPath}`);
      process.exit(1);
    }
  } else {
    console.error("✗ API failed:", json);
    process.exit(1);
  }
}

run().catch((err) => {
  console.error(err);
  process.exit(1);
});
