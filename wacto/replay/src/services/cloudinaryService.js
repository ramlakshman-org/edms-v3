// Fake Cloudinary — records uploads instead of sending them.
const H = (globalThis.__H ||= { cols: {}, sent: [], failCaption: false });

export async function upload(buffer, filename, resourceType = 'image', folder = '') {
  (H.uploads ||= []).push({ bytes: buffer.length, filename, resourceType, folder });
  return { url: `https://cdn.test/${folder}/${filename}`, public_id: `${folder}/${filename}` };
}
export async function destroy() { return true; }
