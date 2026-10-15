import { ImageResponse } from "next/og";
export const size = { width: 512, height: 512 };
export const contentType = "image/png";
export function GET() {
  return new ImageResponse(
    (
      <div
        style={{
          width: 512,
          height: 512,
          background: "#0a0b0a",
          borderRadius: 106,
          display: "flex",
          alignItems: "center",
          justifyContent: "center",
        }}
      >
        <svg width={376} height={341} viewBox="0 0 1005 905" xmlns="http://www.w3.org/2000/svg">
          <path fill="#BFFF24" d="M1005 505L1003 503L992 512L834 667L819 677L803 684L782 688L337 689L308 696L282 713L194 802L92 901L93 905H857L887 903L920 893L953 873L974 852L995 818L1003 792L1005 777V505Z"/> <path fill="#BFFF24" d="M1005 11L1003 10L966 43L528 473L520 483L497 503L468 532L470 535L781 536L805 532L835 516L980 375L991 360L998 346L1004 322L1005 11Z"/>
<path fill="#BFFF24" d="M1 10L0 835L3 836L83 759L86 756L90 752L203 641L215 623L221 609L226 587V216L223 199L216 183L198 161L13 16L1 10Z"/>
<path fill="#BFFF24" d="M834 0L488 1L447 13L414 32L397 46L379 66L365 87L350 123L345 149L344 475L349 479L691 143L691.5 142.5L692.5 141.5L693.5 140.5L694 140L706 128.5L735 100L737 98L739 96L759 74L831 6L834 0Z"/>
        </svg>
      </div>
    ),
    size
  );
}