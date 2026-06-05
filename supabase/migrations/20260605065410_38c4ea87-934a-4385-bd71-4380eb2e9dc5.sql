CREATE POLICY "Broadcaster can update transcripts for own sessions"
ON public.transcripts
FOR UPDATE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = transcripts.session_id AND s.broadcaster_id = auth.uid()))
WITH CHECK (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = transcripts.session_id AND s.broadcaster_id = auth.uid()));

CREATE POLICY "Broadcaster can delete transcripts for own sessions"
ON public.transcripts
FOR DELETE
TO authenticated
USING (EXISTS (SELECT 1 FROM public.sessions s WHERE s.id = transcripts.session_id AND s.broadcaster_id = auth.uid()));