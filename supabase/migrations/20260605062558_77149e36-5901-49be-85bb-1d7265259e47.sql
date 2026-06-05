
-- Allow broadcasters to insert audio for their own sessions; everyone can read (audio URLs are signed but listeners need broad access via signed URLs which use service role anyway).
-- We'll also allow public SELECT so signed URL generation is not strictly necessary in case we switch — but we'll use signed URLs in code.
CREATE POLICY "Broadcasters upload audio to their session folder"
ON storage.objects FOR INSERT
TO authenticated
WITH CHECK (
  bucket_id = 'broadcast-audio'
  AND EXISTS (
    SELECT 1 FROM public.sessions s
    WHERE s.id::text = split_part(name, '/', 1)
      AND s.broadcaster_id = auth.uid()
  )
);

CREATE POLICY "Service role full access broadcast-audio"
ON storage.objects FOR ALL
TO service_role
USING (bucket_id = 'broadcast-audio')
WITH CHECK (bucket_id = 'broadcast-audio');
