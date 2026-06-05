DROP POLICY IF EXISTS "Profiles viewable by everyone" ON public.profiles;

CREATE POLICY "Users can view own profile"
ON public.profiles
FOR SELECT
TO authenticated
USING (auth.uid() = id);