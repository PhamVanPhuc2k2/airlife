// Script https://www.youtube.com/iframe_api gọi hàm toàn cục này khi tải xong.
// @types/youtube khai báo namespace YT nhưng không khai báo hàm này trên window.
export {};

declare global {
  interface Window {
    onYouTubeIframeAPIReady?: () => void;
  }
}
