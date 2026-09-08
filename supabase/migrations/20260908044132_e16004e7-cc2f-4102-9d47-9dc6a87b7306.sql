CREATE OR REPLACE FUNCTION public.set_updated_at() RETURNS TRIGGER AS $$ BEGIN NEW.updated_at = now(); RETURN NEW; END; $$ LANGUAGE plpgsql SET search_path = public;

CREATE TABLE public.workspaces (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  owner_key TEXT NOT NULL,
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.workspaces TO anon, authenticated;
GRANT ALL ON public.workspaces TO service_role;
ALTER TABLE public.workspaces ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest open access workspaces" ON public.workspaces FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_workspaces_updated BEFORE UPDATE ON public.workspaces FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.projects (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  name TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.projects TO anon, authenticated;
GRANT ALL ON public.projects TO service_role;
ALTER TABLE public.projects ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest open access projects" ON public.projects FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_projects_updated BEFORE UPDATE ON public.projects FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.conversations (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  project_id UUID REFERENCES public.projects(id) ON DELETE SET NULL,
  owner_key TEXT NOT NULL,
  title TEXT NOT NULL DEFAULT 'Nuova conversazione',
  provider TEXT NOT NULL DEFAULT 'lovable',
  model TEXT NOT NULL DEFAULT 'google/gemini-3.7-flash',
  runtime TEXT NOT NULL DEFAULT 'cloud',
  mode TEXT NOT NULL DEFAULT 'AUTO',
  agent_enabled BOOLEAN NOT NULL DEFAULT false,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.conversations TO anon, authenticated;
GRANT ALL ON public.conversations TO service_role;
ALTER TABLE public.conversations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest open access conversations" ON public.conversations FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_conversations_updated BEFORE UPDATE ON public.conversations FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.messages (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  conversation_id UUID NOT NULL REFERENCES public.conversations(id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  role TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  parts JSONB NOT NULL DEFAULT '[]'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.messages TO anon, authenticated;
GRANT ALL ON public.messages TO service_role;
ALTER TABLE public.messages ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest open access messages" ON public.messages FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_messages_conversation ON public.messages(conversation_id, created_at);

CREATE TABLE public.vfs_nodes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  parent_id UUID REFERENCES public.vfs_nodes(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'file',
  path TEXT NOT NULL,
  content TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.vfs_nodes TO anon, authenticated;
GRANT ALL ON public.vfs_nodes TO service_role;
ALTER TABLE public.vfs_nodes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest open access vfs" ON public.vfs_nodes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX idx_vfs_unique_path ON public.vfs_nodes(workspace_id, path);
CREATE TRIGGER trg_vfs_updated BEFORE UPDATE ON public.vfs_nodes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.activity_log (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL,
  meta JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.activity_log TO anon, authenticated;
GRANT ALL ON public.activity_log TO service_role;
ALTER TABLE public.activity_log ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest open access activity" ON public.activity_log FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE INDEX idx_activity_ws ON public.activity_log(workspace_id, created_at DESC);

CREATE TABLE public.tool_permissions (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  tool_name TEXT NOT NULL,
  allowed BOOLEAN NOT NULL DEFAULT true,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.tool_permissions TO anon, authenticated;
GRANT ALL ON public.tool_permissions TO service_role;
ALTER TABLE public.tool_permissions ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest open access tool perms" ON public.tool_permissions FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE UNIQUE INDEX idx_tool_perm_unique ON public.tool_permissions(workspace_id, tool_name);
CREATE TRIGGER trg_tool_perm_updated BEFORE UPDATE ON public.tool_permissions FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TABLE public.memory_notes (
  id UUID NOT NULL DEFAULT gen_random_uuid() PRIMARY KEY,
  workspace_id UUID NOT NULL REFERENCES public.workspaces(id) ON DELETE CASCADE,
  owner_key TEXT NOT NULL,
  label TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
GRANT SELECT, INSERT, UPDATE, DELETE ON public.memory_notes TO anon, authenticated;
GRANT ALL ON public.memory_notes TO service_role;
ALTER TABLE public.memory_notes ENABLE ROW LEVEL SECURITY;
CREATE POLICY "guest open access memory" ON public.memory_notes FOR ALL TO anon, authenticated USING (true) WITH CHECK (true);
CREATE TRIGGER trg_memory_updated BEFORE UPDATE ON public.memory_notes FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();