-- KB chunk metadata to improve code understanding + citations.
-- Adds optional symbol/kind/language fields for code-aware chunking.

alter table kb_chunks
  add column if not exists symbol text,
  add column if not exists kind text,
  add column if not exists language text;

create index if not exists kb_chunks_source_symbol_idx on kb_chunks(source_id, symbol);
