import { mkdtemp, readFile, rm } from 'fs/promises';
import { tmpdir } from 'os';
import { join } from 'path';
import { FileStorageService } from './file-storage.service';

describe('FileStorageService', () => {
  let service: FileStorageService;
  let tempDir: string;
  const originalUploadsDir = process.env.UPLOADS_DIR;

  beforeEach(async () => {
    tempDir = await mkdtemp(join(tmpdir(), 'la-brisa-uploads-'));
    process.env.UPLOADS_DIR = tempDir;
    service = new FileStorageService();
  });

  afterEach(async () => {
    process.env.UPLOADS_DIR = originalUploadsDir;
    await rm(tempDir, { recursive: true, force: true });
  });

  it('saves a buffer under a generated filename, preserving the original extension', async () => {
    const filename = await service.save('receipts', Buffer.from('fake image bytes'), 'comprobante.PNG');

    expect(filename).toMatch(/^[0-9a-f-]{36}\.png$/);
    const written = await readFile(join(tempDir, 'receipts', filename));
    expect(written.toString()).toBe('fake image bytes');
  });

  it('creates the subdirectory if it does not exist yet', async () => {
    const filename = await service.save('receipts', Buffer.from('x'), 'a.jpg');
    expect(filename).toBeTruthy();
  });

  it('reads back exactly what was written', async () => {
    const filename = await service.save('receipts', Buffer.from('round trip'), 'x.jpg');
    const contents = await service.read('receipts', filename);
    expect(contents.toString()).toBe('round trip');
  });

  it('deletes a saved file without throwing for a filename that never existed', async () => {
    const filename = await service.save('receipts', Buffer.from('x'), 'x.jpg');
    await expect(service.delete('receipts', filename)).resolves.toBeUndefined();
    await expect(service.delete('receipts', 'never-existed.jpg')).resolves.toBeUndefined();
  });
});
