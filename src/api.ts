export const API_URL = (import.meta.env.VITE_API_URL ?? "").replace(/\/$/, "");
export type User = { id: string; name: string };
export type Run = {
  id: string;
  userId: string;
  author: string;
  caption: string;
  distance: number;
  duration: number;
  runDate: string;
  createdAt: number;
  photoUrl: string;
  likes: number;
  liked: boolean;
};
export type Stats = {
  community: { runs: number; distance: number; runners: number };
  leaders: { name: string; distance: number; runs: number }[];
  personal: { runs: number; distance: number; duration: number };
  days: string[];
};
export async function api<T>(path: string, init?: RequestInit): Promise<T> {
  const response = await fetch(`${API_URL}/api${path}`, {
    ...init,
    credentials: "include",
    signal: init?.signal ?? AbortSignal.timeout(20000),
  });
  const body = await response
    .json()
    .catch(() => ({ error: "서버 연결을 확인해주세요." }));
  if (!response.ok)
    throw new Error(body.error ?? body.message ?? "요청을 처리하지 못했어요.");
  return body;
}
export function today() {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Seoul",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
}
export function pace(distance: number, duration: number) {
  const seconds = Math.round((duration * 60) / distance);
  return `${Math.floor(seconds / 60)}′${String(seconds % 60).padStart(2, "0")}″`;
}
export async function compress(file: File): Promise<File> {
  if (!["image/jpeg", "image/png", "image/webp"].includes(file.type))
    throw new Error("JPG, PNG, WebP 사진을 선택해주세요.");
  if (file.size > 20_000_000)
    throw new Error("20MB 이하의 사진을 선택해주세요.");
  const bitmap = await createImageBitmap(file);
  try {
    const scale = Math.min(1, 1400 / Math.max(bitmap.width, bitmap.height));
    const canvas = document.createElement("canvas");
    canvas.width = Math.round(bitmap.width * scale);
    canvas.height = Math.round(bitmap.height * scale);
    const context = canvas.getContext("2d");
    if (!context) throw new Error("사진을 처리할 수 없어요.");
    context.fillStyle = "#fff";
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    const blob = await new Promise<Blob>((resolve, reject) =>
      canvas.toBlob(
        (b) => (b ? resolve(b) : reject(new Error("사진을 처리할 수 없어요."))),
        "image/jpeg",
        0.8,
      ),
    );
    if (blob.size > 1_200_000)
      throw new Error("사진이 너무 복잡해요. 크기를 줄여 다시 선택해주세요.");
    return new File([blob], "run.jpg", { type: "image/jpeg" });
  } finally {
    bitmap.close();
  }
}
