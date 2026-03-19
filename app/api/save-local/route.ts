import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: Request) {
  try {
    const data = await req.arrayBuffer();
    const buffer = Buffer.from(data);
    
    const targetDir = 'C:\DLB';
    const targetFile = path.join(targetDir, '1.xlsx');
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Clear any existing files in the directory
    // Ensure we only delete files to avoid deleting subdirectories if any exist
    const files = fs.readdirSync(targetDir);
    for (const file of files) {
      const filePath = path.join(targetDir, file);
      if (fs.statSync(filePath).isFile()) {
        fs.unlinkSync(filePath);
      }
    }
    
    // Write the new file
    fs.writeFileSync(targetFile, buffer);
    
    return NextResponse.json({ success: true, message: `Saved successfully to ${targetFile}` });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
