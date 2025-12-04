import * as XLSX from "xlsx";

export async function POST(req: Request) {
  // Read form-data
  const formData = await req.formData();
  const file = formData.get("file") as File | null;

  if (!file) {
    return new Response("No file uploaded", { status: 400 });
  }

  // Read the uploaded .xls as ArrayBuffer
  const arrayBuffer = await file.arrayBuffer();

  // Parse workbook (supports .xls)
  const workbook = XLSX.read(arrayBuffer, { type: "array" });

  // Write workbook as .xlsx into a Buffer
  const xlsxBuffer = XLSX.write(workbook, {
    bookType: "xlsx",
    type: "buffer",
  }) as Buffer;

  // Build a new filename
  const originalName = file.name;
  const newName = originalName.replace(/\.xls$/i, ".xlsx");

  // Return the .xlsx as a file download
  return new Response(new Uint8Array(xlsxBuffer), {
    status: 200,
    headers: {
      "Content-Type":
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "Content-Disposition": `attachment; filename="${newName}"`,
    },
  });
}
