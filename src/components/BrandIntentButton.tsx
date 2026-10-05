import './BrandIntentButton.css';

type Intent = 'social' | 'spicy' | 'private';

export function BrandIntentButton({
  intent,
  children,
  className = '',
  ...props
}: React.ButtonHTMLAttributes<HTMLButtonElement> & { intent: Intent }) {
  return (
    <button
      {...props}
      className={`gayze-intent-button ${className}`.trim()}
      data-intent={intent}
    >
      {children}
    </button>
  );
}
