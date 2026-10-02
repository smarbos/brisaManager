import { Injectable } from '@nestjs/common';
import { randomUUID } from 'crypto';
import { mkdir, readFile, unlink, writeFile } from 'fs/promises';
import { extname, join } from 'path';

// Local disk under a Docker volume (see docker-compose.yml's `receipts_data` volume), not
// object storage — this app runs on a single droplet with no other durability requirement
// beyond what the droplet's own backups already provide, and this avoids a new external
// dependency/credentials for what's a small, low-volume upload (payment receipts).
const DEFAULT_UPLOADS_DIR = '/app/uploads';

@Injectable()
export class FileStorageService {
  private readonly baseDir: string;

  constructor() {
    this.baseDir = process.env.UPLOADS_DIR || DEFAULT_UPLOADS_DIR;
  }

  // `subdir` groups files by purpose (e.g. "receipts") so different features never collide
  // on filenames even though each one only generates a bare uuid + extension.
  async save(subdir: string, buffer: Buffer, originalFilename: string): Promise<string> {
    const dir = join(this.baseDir, subdir);
    await mkdir(dir, { recursive: true });
    const filename = `${randomUUID()}${extname(originalFilename).toLowerCase()}`;
    await writeFile(join(dir, filename), buffer);
    return filename;
  }

  async read(subdir: string, filename: string): Promise<Buffer> {
    return readFile(join(this.baseDir, subdir, filename));
  }

  // An already-missing file counts as deleted; any other failure (permissions, I/O) throws,
  // so a caller like the receipt retention job never records a deletion that didn't happen.
  async delete(subdir: string, filename: string): Promise<void> {
    await unlink(join(this.baseDir, subdir, filename)).catch((error: NodeJS.ErrnoException) => {
      if (error.code !== 'ENOENT') {
        throw error;
      }
    });
  }
}
