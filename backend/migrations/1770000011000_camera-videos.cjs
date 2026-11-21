// Phone cameras (iPhone in particular) record QuickTime .mov files. Accept them;
// every upload is still transcoded to H.264 MP4 before anyone can watch it.
exports.up = (pgm) => {
  pgm.sql(`
    ALTER TABLE public.media_assets DROP CONSTRAINT media_assets_content_type_check;
    ALTER TABLE public.media_assets ADD CONSTRAINT media_assets_content_type_check CHECK (
      content_type IN (
        'image/jpeg', 'image/png', 'image/webp',
        'video/mp4', 'video/webm', 'video/quicktime'
      )
    );
  `);
};
exports.down = false;
