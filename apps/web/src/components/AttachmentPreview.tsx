import { useEffect, useState } from 'react';
import { Download, ExternalLink, FileText, Film, Paperclip, X } from 'lucide-react';
import { downloadFile, fetchBlob } from '../lib/api';

export interface AttachmentLike {
  id: string;
  filename: string;
  mimeType: string;
  size: number;
}

// SVG fica de fora de propósito: pode carregar script. Só tipos que o navegador
// exibe sem executar nada viram pré-visualização; o resto é só download.
const PREVIEW_IMAGE = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const PREVIEW_AUDIO = /^audio\//;
const PREVIEW_VIDEO = new Set(['video/mp4', 'video/webm', 'video/3gpp']);

const downloadPath = (a: AttachmentLike) => `/api/attachments/${a.id}/download`;

function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${Math.round(n / 1024)} KB`;
  return `${(n / 1024 / 1024).toFixed(1)} MB`;
}

/** Carrega o anexo (com o token) e expõe uma URL blob: local, liberada ao desmontar. */
function useBlobUrl(a: AttachmentLike, enabled: boolean) {
  const [url, setUrl] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!enabled) return;
    let objectUrl: string | null = null;
    let cancelled = false;
    fetchBlob(downloadPath(a))
      .then((blob) => {
        if (cancelled) return;
        objectUrl = URL.createObjectURL(blob);
        setUrl(objectUrl);
      })
      .catch(() => !cancelled && setFailed(true));
    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [a.id, enabled]);
  return { url, failed };
}

function DownloadChip({ a }: { a: AttachmentLike }) {
  return (
    <button
      type="button"
      className="flex max-w-full items-center gap-1 text-xs text-brand-600 hover:underline"
      onClick={() => downloadFile(downloadPath(a), a.filename)}
    >
      <Paperclip className="h-3 w-3 shrink-0" />
      <span className="truncate">{a.filename}</span>
      <span className="shrink-0 text-slate-400">({fmtBytes(a.size)})</span>
    </button>
  );
}

function ImagePreview({ a }: { a: AttachmentLike }) {
  const { url, failed } = useBlobUrl(a, true);
  const [open, setOpen] = useState(false);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === 'Escape' && setOpen(false);
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [open]);
  if (failed) return <DownloadChip a={a} />;
  return (
    <>
      <button
        type="button"
        title={a.filename}
        className="block overflow-hidden rounded-lg border border-slate-200 bg-slate-50 hover:border-brand-300"
        onClick={() => url && setOpen(true)}
      >
        {url ? (
          <img src={url} alt={a.filename} className="h-32 w-32 object-cover" />
        ) : (
          <div className="h-32 w-32 animate-pulse bg-slate-100" />
        )}
      </button>
      {open && url && (
        <div className="fixed inset-0 z-50 flex flex-col items-center justify-center gap-3 bg-black/80 p-4" onClick={() => setOpen(false)}>
          <img src={url} alt={a.filename} className="max-h-[85vh] max-w-full rounded object-contain" onClick={(e) => e.stopPropagation()} />
          <div className="flex items-center gap-3 text-sm text-white" onClick={(e) => e.stopPropagation()}>
            <span className="max-w-[60vw] truncate">{a.filename}</span>
            <button type="button" className="flex items-center gap-1 rounded bg-white/15 px-2 py-1 hover:bg-white/25" onClick={() => downloadFile(downloadPath(a), a.filename)}>
              <Download className="h-4 w-4" /> Baixar
            </button>
            <button type="button" className="flex items-center gap-1 rounded bg-white/15 px-2 py-1 hover:bg-white/25" onClick={() => setOpen(false)}>
              <X className="h-4 w-4" /> Fechar
            </button>
          </div>
        </div>
      )}
    </>
  );
}

function AudioPreview({ a }: { a: AttachmentLike }) {
  const { url, failed } = useBlobUrl(a, true);
  if (failed) return <DownloadChip a={a} />;
  return (
    <div className="flex max-w-full flex-col gap-1">
      {url ? <audio controls preload="metadata" src={url} className="h-10 w-72 max-w-full" /> : <div className="h-10 w-72 max-w-full animate-pulse rounded-full bg-slate-100" />}
      <DownloadChip a={a} />
    </div>
  );
}

/** Vídeo só baixa quando o técnico pede — pode ter vários MB. */
function VideoPreview({ a }: { a: AttachmentLike }) {
  const [load, setLoad] = useState(false);
  const { url, failed } = useBlobUrl(a, load);
  if (failed) return <DownloadChip a={a} />;
  return (
    <div className="flex max-w-full flex-col gap-1">
      {url ? (
        <video controls autoPlay src={url} className="max-h-72 max-w-full rounded-lg bg-black" />
      ) : (
        <button
          type="button"
          className="flex h-24 w-44 flex-col items-center justify-center gap-1 rounded-lg border border-slate-200 bg-slate-50 text-xs text-slate-600 hover:border-brand-300"
          onClick={() => setLoad(true)}
          disabled={load}
        >
          <Film className="h-6 w-6 text-slate-400" />
          {load ? 'Carregando…' : `Assistir vídeo (${fmtBytes(a.size)})`}
        </button>
      )}
      <DownloadChip a={a} />
    </div>
  );
}

function PdfPreview({ a }: { a: AttachmentLike }) {
  async function openPdf() {
    // A aba precisa abrir já no clique (senão o bloqueador de pop-up barra); o conteúdo chega depois
    const win = window.open('', '_blank');
    try {
      const blob = await fetchBlob(downloadPath(a));
      const url = URL.createObjectURL(new Blob([blob], { type: 'application/pdf' }));
      if (win) win.location.href = url;
      else window.location.href = url;
      setTimeout(() => URL.revokeObjectURL(url), 60_000);
    } catch {
      win?.close();
    }
  }
  return (
    <div className="flex items-center gap-2 rounded-lg border border-slate-200 bg-slate-50 px-2 py-1.5 text-xs">
      <FileText className="h-5 w-5 shrink-0 text-red-500" />
      <span className="max-w-56 truncate text-slate-700" title={a.filename}>{a.filename}</span>
      <span className="shrink-0 text-slate-400">{fmtBytes(a.size)}</span>
      <button type="button" className="flex shrink-0 items-center gap-1 text-brand-600 hover:underline" onClick={openPdf}>
        <ExternalLink className="h-3 w-3" /> Abrir
      </button>
      <button type="button" className="flex shrink-0 items-center gap-1 text-brand-600 hover:underline" onClick={() => downloadFile(downloadPath(a), a.filename)}>
        <Download className="h-3 w-3" /> Baixar
      </button>
    </div>
  );
}

/** Lista de anexos com pré-visualização: fotos em miniatura, áudio/vídeo com player, PDF abre em aba. */
export function AttachmentList({ attachments }: { attachments: AttachmentLike[] | undefined }) {
  if (!attachments?.length) return null;
  const images = attachments.filter((a) => PREVIEW_IMAGE.has(a.mimeType));
  const others = attachments.filter((a) => !PREVIEW_IMAGE.has(a.mimeType));
  return (
    <div className="mt-2 space-y-2">
      {images.length > 0 && (
        <div className="flex flex-wrap gap-2">
          {images.map((a) => <ImagePreview key={a.id} a={a} />)}
        </div>
      )}
      {others.map((a) => {
        if (PREVIEW_AUDIO.test(a.mimeType)) return <AudioPreview key={a.id} a={a} />;
        if (PREVIEW_VIDEO.has(a.mimeType)) return <VideoPreview key={a.id} a={a} />;
        if (a.mimeType === 'application/pdf') return <PdfPreview key={a.id} a={a} />;
        return <DownloadChip key={a.id} a={a} />;
      })}
    </div>
  );
}
