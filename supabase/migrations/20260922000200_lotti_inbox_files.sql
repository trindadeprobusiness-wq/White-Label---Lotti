insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types)
values('lotti-inbox-files','lotti-inbox-files',false,104857600,array[
 'application/pdf','application/msword','application/vnd.openxmlformats-officedocument.wordprocessingml.document',
 'application/vnd.ms-excel','application/vnd.openxmlformats-officedocument.spreadsheetml.sheet',
 'application/vnd.ms-powerpoint','application/vnd.openxmlformats-officedocument.presentationml.presentation',
 'text/plain','text/csv','application/zip','application/x-zip-compressed',
 'image/jpeg','image/png','image/webp','image/gif','video/mp4','video/webm','video/quicktime',
 'audio/mpeg','audio/ogg','audio/mp4','audio/x-m4a','audio/wav','audio/x-wav','audio/webm'
]) on conflict(id) do update set public=false,file_size_limit=excluded.file_size_limit,allowed_mime_types=excluded.allowed_mime_types;

create policy lotti_files_owner_read on storage.objects for select to authenticated
using(bucket_id='lotti-inbox-files' and exists(select 1 from public.corretores where user_id=auth.uid() and id::text=(storage.foldername(name))[1]));
