import { NextRequest, NextResponse } from 'next/server';
import { readSHLFile } from '@/lib/filesystem-file-handlers';

export async function GET(
  _request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const { fileId } = await params;

    // Validate fileId to prevent path traversal
    if (!fileId || !/^[a-f0-9]{32}$/.test(fileId)) {
      return NextResponse.json(
        { error: 'Invalid file ID' },
        { status: 400 }
      );
    }

    // Read the file content
    const content = await readSHLFile(fileId);

    // Return the content with appropriate headers for JWE files
    return new NextResponse(content, {
      status: 200,
      headers: {
        'Content-Type': 'application/jose',
        'Cache-Control': 'private, no-cache, no-store, must-revalidate',
        'Pragma': 'no-cache',
        'Expires': '0',
      },
    });

  } catch (error) {
    console.error('Error serving SHL file:', error);

    if (error instanceof Error && error.message.includes('not found')) {
      return NextResponse.json(
        { error: 'File not found' },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: 'Internal server error' },
      { status: 500 }
    );
  }
}
