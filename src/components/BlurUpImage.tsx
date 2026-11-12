import React, { useEffect, useRef, useState } from "react";

interface BlurUpImageProps extends React.ImgHTMLAttributes<HTMLImageElement> {
  /** Extra class names merged with blur-up classes */
  className?: string;
}

/**
 * Hide progressive top-to-bottom paint; reveal with blur → sharp once fully loaded.
 * Failed loads render nothing and invoke onError so parents can drop the src.
 */
export const BlurUpImage: React.FC<BlurUpImageProps> = ({
  className = "",
  src,
  onLoad,
  onError,
  ...rest
}) => {
  const [loaded, setLoaded] = useState(false);
  const [failed, setFailed] = useState(false);
  const errorNotified = useRef(false);

  useEffect(() => {
    setLoaded(false);
    setFailed(false);
    errorNotified.current = false;
  }, [src]);

  const markFailed = (
    e?: React.SyntheticEvent<HTMLImageElement, Event>
  ) => {
    setFailed(true);
    if (errorNotified.current) return;
    errorNotified.current = true;
    if (e) onError?.(e);
    else onError?.({} as React.SyntheticEvent<HTMLImageElement, Event>);
  };

  if (failed || !src) return null;

  return (
    <img
      {...rest}
      src={src}
      className={`img-blur-up ${loaded ? "is-loaded" : "is-loading"} ${className}`.trim()}
      onLoad={(e) => {
        setLoaded(true);
        onLoad?.(e);
      }}
      onError={(e) => markFailed(e)}
      ref={(el) => {
        if (!el?.complete) return;
        if (el.naturalWidth > 0) setLoaded(true);
        else markFailed();
      }}
    />
  );
};
