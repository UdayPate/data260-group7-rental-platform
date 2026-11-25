// A listing's photo with an arched top (the "arch-photo" class in index.css).
// No photo_url, or the image fails to load: a plain tile with a house icon and the type.
import { useState } from 'react'
import { HouseIcon } from './icons'

type Props = {
  photoUrl: string
  typeLabel: string // e.g. "House", shown on the fallback tile
  className: string // height (and any extra spacing), e.g. "h-[190px]"
  large?: boolean // bigger icon on the property page
}

function PropertyPhoto({ photoUrl, typeLabel, className, large = false }: Props) {
  // The URL that failed to load (remembering the URL, not just true/false, means a
  // different listing's photo gets its own fresh try).
  const [failedUrl, setFailedUrl] = useState('')

  if (photoUrl && photoUrl !== failedUrl) {
    return (
      <div className={`arch-photo ${className}`}>
        <img src={photoUrl} alt="" onError={() => setFailedUrl(photoUrl)} className="h-full w-full object-cover" />
      </div>
    )
  }
  return (
    <div data-photo-fallback className={`arch-photo flex flex-col items-center justify-center gap-2 bg-surface-2 text-fg-muted ${className}`}>
      <HouseIcon className={large ? 'h-20 w-20' : 'h-12 w-12'} />
      <span className="font-condensed text-sm font-bold tracking-[0.08em] uppercase">{typeLabel}</span>
    </div>
  )
}

export default PropertyPhoto
