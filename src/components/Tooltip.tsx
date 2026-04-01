import React, { useState, useRef, useEffect } from 'react';
import { createPortal } from 'react-dom';
import { motion, AnimatePresence } from 'motion/react';

interface TooltipProps {
  children: React.ReactNode;
  content: React.ReactNode;
  position?: 'top' | 'bottom' | 'left' | 'right';
  className?: string;
  contentClassName?: string;
}

export const Tooltip: React.FC<TooltipProps> = ({ children, content, position = 'top', className = "inline-block", contentClassName = "" }) => {
  const [isVisible, setIsVisible] = useState(false);
  const [coords, setCoords] = useState({ top: 0, left: 0 });
  const triggerRef = useRef<HTMLDivElement>(null);
  const timeoutRef = useRef<NodeJS.Timeout | null>(null);

  const updateCoords = () => {
    if (triggerRef.current) {
      const rect = triggerRef.current.getBoundingClientRect();
      const scrollX = window.scrollX;
      const scrollY = window.scrollY;

      let top = 0;
      let left = 0;

      switch (position) {
        case 'top':
          top = rect.top + scrollY - 10;
          left = rect.left + scrollX + rect.width / 2;
          break;
        case 'bottom':
          top = rect.bottom + scrollY + 10;
          left = rect.left + scrollX + rect.width / 2;
          break;
        case 'left':
          top = rect.top + scrollY + rect.height / 2;
          left = rect.left + scrollX - 10;
          break;
        case 'right':
          top = rect.top + scrollY + rect.height / 2;
          left = rect.right + scrollX + 10;
          break;
      }

      setCoords({ top, left });
    }
  };

  useEffect(() => {
    if (isVisible) {
      updateCoords();
      window.addEventListener('scroll', updateCoords, true);
      window.addEventListener('resize', updateCoords);
    }
    return () => {
      window.removeEventListener('scroll', updateCoords, true);
      window.removeEventListener('resize', updateCoords);
    };
  }, [isVisible]);

  const handleMouseEnter = () => {
    timeoutRef.current = setTimeout(() => {
      setIsVisible(true);
    }, 300); // 300ms delay
  };

  const handleMouseLeave = () => {
    if (timeoutRef.current) {
      clearTimeout(timeoutRef.current);
    }
    setIsVisible(false);
  };

  const getTransformOrigin = () => {
    switch (position) {
      case 'top': return 'bottom center';
      case 'bottom': return 'top center';
      case 'left': return 'right center';
      case 'right': return 'left center';
      default: return 'center';
    }
  };

  const getTranslate = () => {
    switch (position) {
      case 'top': return { x: '-50%', y: '-100%' };
      case 'bottom': return { x: '-50%', y: '0%' };
      case 'left': return { x: '-100%', y: '-50%' };
      case 'right': return { x: '0%', y: '-50%' };
      default: return { x: '-50%', y: '-50%' };
    }
  };

  return (
    <div 
      ref={triggerRef}
      className={className}
      onMouseEnter={handleMouseEnter}
      onMouseLeave={handleMouseLeave}
      onFocus={() => setIsVisible(true)}
      onBlur={handleMouseLeave}
    >
      {children}
      {createPortal(
        <AnimatePresence>
          {isVisible && (
            <motion.div
              initial={{ opacity: 0, scale: 0.9, ...getTranslate() }}
              animate={{ opacity: 1, scale: 1, ...getTranslate() }}
              exit={{ opacity: 0, scale: 0.9, ...getTranslate() }}
              transition={{ duration: 0.1, ease: "easeOut" }}
              style={{
                position: 'absolute',
                top: coords.top,
                left: coords.left,
                transformOrigin: getTransformOrigin(),
                zIndex: 9999,
              }}
              className="pointer-events-none"
            >
              <div className={`max-w-[280px] px-3 py-2 bg-slate-800 text-white text-[10px] font-black tracking-wide rounded-lg shadow-2xl whitespace-pre-line break-words relative leading-4 ${contentClassName}`.trim()}>
                {content}
                {/* Arrow */}
                <div className={`absolute w-2 h-2 bg-slate-800 rotate-45 ${
                  position === 'top' ? 'top-full -mt-1 left-1/2 -translate-x-1/2' :
                  position === 'bottom' ? 'bottom-full -mb-1 left-1/2 -translate-x-1/2' :
                  position === 'left' ? 'left-full -ml-1 top-1/2 -translate-y-1/2' :
                  'right-full -mr-1 top-1/2 -translate-y-1/2'
                }`} />
              </div>
            </motion.div>
          )}
        </AnimatePresence>,
        document.body
      )}
    </div>
  );
};
