import "react";
import type { Socket } from "socket.io-client";

declare module "react" {
  interface CSSProperties {
    [key: `--${string}`]: string | number | undefined;
  }
}

declare global {
  interface Window {
    diffriendtiateSocket?: Socket;
  }
}
