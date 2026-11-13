import { useState } from 'react';

interface BrandMarkProps {
  size?: 'sm' | 'lg';
}

export function BrandMark({ size = 'sm' }: BrandMarkProps) {
  const [imgFailed, setImgFailed] = useState(false);
  const dimension = size === 'lg' ? 'w-20 h-20 rounded-2xl' : 'w-9 h-9 rounded-xl';

  if (imgFailed) {
    return (
      <div
        className={`${dimension} bg-[#183B38] text-[#F5F7F4] flex items-center justify-center shrink-0 shadow-sm`}
        aria-hidden="true"
      >
        <svg viewBox="0 0 24 24" className="w-3/5 h-3/5 fill-none stroke-current" strokeWidth={2}>
          <path d="M4 5h16a2 2 0 0 1 2 2v9a2 2 0 0 1-2 2H9l-5 4v-4H4a2 2 0 0 1-2-2V7a2 2 0 0 1 2-2Z" />
          <path d="m6 9 6 4 6-4" />
        </svg>
      </div>
    );
  }

  return (
    <img
      src="/src/assets/images/vartalap_forest_jade_icon_1794573083117.jpg"
      alt="Vartalap app icon"
      referrerPolicy="no-referrer"
      onError={() => setImgFailed(true)}
      className={`${dimension} object-cover shrink-0 shadow-sm border border-[#183B38]/15 dark:border-[#DCEBE2]/20`}
    />
  );
}
