import { useState, useEffect, useRef } from "react";
import type { FormEvent } from "react";
import {
  ArrowUpRight,
  Camera,
  ImagePlus,
  LoaderCircle,
  ShieldCheck,
  X,
} from "lucide-react";
import Modal from "./Modal";
import { api, compress, today } from "./api";
export default function Composer({
  close,
  done,
}: {
  close: () => void;
  done: () => void;
}) {
  const [photo, setPhoto] = useState<File | null>(null),
    [preview, setPreview] = useState(""),
    [caption, setCaption] = useState(""),
    [busy, setBusy] = useState(false),
    [processing, setProcessing] = useState(false),
    [error, setError] = useState("");
  const fileRef = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (!photo) {
      setPreview("");
      return;
    }
    const url = URL.createObjectURL(photo);
    setPreview(url);
    return () => URL.revokeObjectURL(url);
  }, [photo]);
  async function choose(file?: File) {
    if (!file) return;
    setError("");
    setProcessing(true);
    try {
      setPhoto(await compress(file));
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setProcessing(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }
  async function submit(e: FormEvent<HTMLFormElement>) {
    e.preventDefault();
    if (!photo) {
      setError("오늘의 러닝 사진을 선택해주세요.");
      return;
    }
    setBusy(true);
    setError("");
    const form = new FormData(e.currentTarget);
    form.set("photo", photo);
    try {
      await api("/posts", { method: "POST", body: form });
      done();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }
  return (
    <Modal
      title="오늘의 러닝 인증"
      close={() => {
        if (!busy) close();
      }}
      wide
    >
      <form onSubmit={submit} className="composer">
        <p className="muted">잘 달렸어요. 오늘의 한 걸음을 남겨볼까요?</p>
        <div className="compose-grid">
          <div>
            <input
              ref={fileRef}
              className="visually-hidden"
              aria-label="러닝 사진"
              type="file"
              accept="image/jpeg,image/png,image/webp"
              onChange={(e) => void choose(e.target.files?.[0])}
            />
            <button
              type="button"
              className={`photo-picker ${preview ? "has-photo" : ""}`}
              onClick={() => fileRef.current?.click()}
              disabled={processing || busy}
              onDragOver={(e) => e.preventDefault()}
              onDrop={(e) => {
                e.preventDefault();
                if (!busy && !processing) void choose(e.dataTransfer.files[0]);
              }}
            >
              {preview ? (
                <>
                  <img src={preview} alt="선택한 러닝 사진" />
                  <span>
                    <Camera size={16} /> 사진 바꾸기
                  </span>
                </>
              ) : (
                <>
                  {processing ? (
                    <LoaderCircle className="spin" size={32} />
                  ) : (
                    <ImagePlus size={38} strokeWidth={1.3} />
                  )}
                  <strong>
                    {processing
                      ? "사진을 준비하고 있어요"
                      : "러닝의 순간을 올려주세요"}
                  </strong>
                  <small>
                    클릭하거나 사진을 끌어다 놓으세요
                    <br />
                    JPG · PNG · WebP / 최대 20MB
                  </small>
                </>
              )}
            </button>
            <p className="photo-note">
              <ShieldCheck size={14} /> 사진의 위치 정보는 업로드 전에 제거해요.
            </p>
          </div>
          <div className="compose-fields">
            <div className="two-fields">
              <label>
                달린 거리 <span>km</span>
                <input
                  required
                  name="distance"
                  type="number"
                  step="0.01"
                  min="0.01"
                  max="300"
                  placeholder="5.00"
                  inputMode="decimal"
                />
              </label>
              <label>
                달린 시간 <span>분</span>
                <input
                  required
                  name="duration"
                  type="number"
                  min="1"
                  max="4320"
                  placeholder="30"
                  inputMode="numeric"
                />
              </label>
            </div>
            <label>
              러닝 날짜
              <input
                required
                name="runDate"
                type="date"
                min="2000-01-01"
                max={today()}
                defaultValue={today()}
              />
            </label>
            <label>
              오늘의 한마디 <span>선택</span>
              <textarea
                name="caption"
                rows={4}
                maxLength={300}
                value={caption}
                onChange={(e) => setCaption(e.target.value)}
                placeholder="오늘의 페이스, 달리며 본 풍경, 함께한 사람들…"
              />
              <small className="counter">{caption.length} / 300</small>
            </label>
            <p className="disclosure">
              사진과 글, 이름, 러닝 기록은 모든 방문자에게 공개됩니다. 다른
              사람의 개인정보가 담기지 않도록 확인해주세요.
            </p>
          </div>
        </div>
        {error ? (
          <p role="alert" className="form-error">
            <X size={15} />
            {error}
          </p>
        ) : null}
        <button
          className="button primary submit"
          disabled={busy || processing}
          type="submit"
        >
          {busy ? (
            <>
              <LoaderCircle className="spin" size={18} />
              인증 올리는 중
            </>
          ) : (
            <>
              러닝 인증하기
              <ArrowUpRight size={19} />
            </>
          )}
        </button>
      </form>
    </Modal>
  );
}
