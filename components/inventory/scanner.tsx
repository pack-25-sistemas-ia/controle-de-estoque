'use client';

import { useEffect, useRef, useState } from 'react';
import { Alert, Button } from '@/components/ui/primitives';

type Detector = { detect: (src: CanvasImageSource) => Promise<Array<{ rawValue: string }>> };
type DetectorCtor = new (opts?: { formats?: string[] }) => Detector;

/**
 * Leitura de código de barras pela câmera. Só abre depois de um clique (o navegador pede a permissão); sempre há a alternativa de digitar,
 * colar ou usar leitor USB (que age como teclado). Usa o `BarcodeDetector` nativo quando existe; senão carrega o ZXing sob demanda.
 */
export function Scanner({ onCode, onClose }: { onCode: (code: string) => void; onClose: () => void }) {
  const video = useRef<HTMLVideoElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [status, setStatus] = useState('Iniciando a câmera…');
  const last = useRef<{ code: string; at: number }>({ code: '', at: 0 });

  useEffect(() => {
    let stopped = false;
    let stream: MediaStream | null = null;
    let controls: { stop: () => void } | null = null;
    const emit = (code: string) => {
      const now = Date.now();
      if (code === last.current.code && now - last.current.at < 2500) return;   // mesmo código lido em sequência: ignora
      last.current = { code, at: now };
      onCode(code);
      setStatus(`Código lido: ${code}`);
    };
    async function start() {
      if (!navigator.mediaDevices?.getUserMedia) { setError('Este navegador não permite usar a câmera. Digite o código ou use um leitor USB.'); return; }
      try {
        const Native = (window as unknown as { BarcodeDetector?: DetectorCtor }).BarcodeDetector;
        if (Native) {
          stream = await navigator.mediaDevices.getUserMedia({ video: { facingMode: { ideal: 'environment' } }, audio: false });
          if (stopped) { stream.getTracks().forEach((t) => t.stop()); return; }
          const el = video.current!;
          el.srcObject = stream;
          await el.play();
          setStatus('Aponte para o código de barras.');
          const det = new Native({ formats: ['ean_13', 'ean_8', 'upc_a', 'upc_e', 'code_128', 'code_39', 'qr_code'] });
          const tick = async () => {
            if (stopped) return;
            try { const found = await det.detect(el); if (found[0]?.rawValue) emit(found[0].rawValue); } catch { /* quadro sem código */ }
            setTimeout(tick, 250);
          };
          void tick();
        } else {
          const { BrowserMultiFormatReader } = await import('@zxing/browser');
          const reader = new BrowserMultiFormatReader();
          controls = await reader.decodeFromVideoDevice(undefined, video.current!, (result) => { if (result) emit(result.getText()); });
          setStatus('Aponte para o código de barras.');
        }
      } catch (e) {
        const name = e instanceof DOMException ? e.name : '';
        setError(name === 'NotAllowedError' ? 'A permissão da câmera foi negada. Libere o acesso no navegador ou digite o código.' : name === 'NotFoundError' ? 'Nenhuma câmera encontrada. Digite o código ou use um leitor USB.' : 'Não foi possível iniciar a câmera. Digite o código ou use um leitor USB.');
      }
    }
    void start();
    return () => { stopped = true; controls?.stop(); stream?.getTracks().forEach((t) => t.stop()); };
  }, [onCode]);

  return (
    <div className="space-y-2 rounded-lg border border-border bg-card p-3" role="dialog" aria-label="Leitura de código de barras pela câmera">
      {error ? <Alert tone="error">{error}</Alert> : <video ref={video} className="max-h-64 w-full rounded-md bg-black" muted playsInline aria-label="Imagem da câmera" />}
      <p className="text-xs text-muted" role="status">{error ? '' : status}</p>
      <Button type="button" variant="secondary" onClick={onClose}>Fechar câmera</Button>
    </div>
  );
}
