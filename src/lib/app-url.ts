/**
 * Public address of the site, used in invitation and password links.
 * APP_URL wins; on Render the platform's own address is used automatically.
 */
export function appUrl(): string {
  const url = process.env.APP_URL || process.env.RENDER_EXTERNAL_URL || 'http://localhost:3000';
  return url.replace(/\/+$/, '');
}
