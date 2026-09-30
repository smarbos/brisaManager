import { detectImageType, isServableMimeType } from './image-type';

const bytes = (...values: number[]) => Buffer.from(values);

describe('detectImageType', () => {
  it('recognizes JPEG', () => {
    expect(detectImageType(bytes(0xff, 0xd8, 0xff, 0xe0, 0x00))).toEqual({
      mimeType: 'image/jpeg',
      extension: '.jpg',
    });
  });

  it('recognizes PNG', () => {
    expect(
      detectImageType(
        bytes(0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00),
      ),
    ).toEqual({
      mimeType: 'image/png',
      extension: '.png',
    });
  });

  it('recognizes GIF', () => {
    expect(detectImageType(Buffer.from('GIF89a....'))).toEqual({
      mimeType: 'image/gif',
      extension: '.gif',
    });
  });

  it('recognizes WebP', () => {
    expect(
      detectImageType(Buffer.from('RIFF\x00\x00\x00\x00WEBPVP8 ', 'latin1')),
    ).toEqual({
      mimeType: 'image/webp',
      extension: '.webp',
    });
  });

  it('recognizes HEIC', () => {
    expect(
      detectImageType(
        Buffer.from('\x00\x00\x00\x18ftypheic\x00\x00', 'latin1'),
      ),
    ).toEqual({
      mimeType: 'image/heic',
      extension: '.heic',
    });
  });

  it('rejects SVG, even though a browser would call it image/svg+xml', () => {
    expect(
      detectImageType(
        Buffer.from(
          '<svg xmlns="http://www.w3.org/2000/svg"><script>alert(1)</script></svg>',
        ),
      ),
    ).toBeNull();
  });

  it('rejects HTML and empty buffers', () => {
    expect(
      detectImageType(Buffer.from('<html><script>alert(1)</script></html>')),
    ).toBeNull();
    expect(detectImageType(Buffer.alloc(0))).toBeNull();
  });
});

describe('isServableMimeType', () => {
  it('allows the detected raster types only', () => {
    expect(isServableMimeType('image/jpeg')).toBe(true);
    expect(isServableMimeType('image/svg+xml')).toBe(false);
    expect(isServableMimeType('text/html')).toBe(false);
  });
});
