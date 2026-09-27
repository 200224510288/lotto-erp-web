import { NextResponse } from 'next/server';
import fs from 'fs';
import path from 'path';

export async function POST(req: Request) {
  try {
    const url = new URL(req.url);
    const queryFilename = url.searchParams.get('filename');
    const headerFilename = req.headers.get('x-filename');
    let filename = queryFilename || headerFilename || 'RT.xlsx';
    if (!filename.toLowerCase().endsWith('.xlsx')) {
      filename += '.xlsx';
    }

    const data = await req.arrayBuffer();
    const buffer = Buffer.from(data);
    
    const targetDir = 'C:\\DLB';
    const targetFile = path.join(targetDir, filename);
    
    // Create directory if it doesn't exist
    if (!fs.existsSync(targetDir)) {
      fs.mkdirSync(targetDir, { recursive: true });
    }
    
    // Write the new file
    fs.writeFileSync(targetFile, buffer);
    
    return NextResponse.json({ success: true, message: `Saved successfully to ${targetFile}`, filename, path: targetFile });
  } catch (error: any) {
    return NextResponse.json({ success: false, error: error.message }, { status: 500 });
  }
}
