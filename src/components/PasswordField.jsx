import { useState } from 'react';

export default function PasswordField({
    value,
    onChange,
    placeholder,
    autoComplete = 'current-password',
    id,
    name,
    inputStyle,
    wrapperStyle,
    className = '',
    ...props
}) {
    const [isVisible, setIsVisible] = useState(false);

    return (
        <div className={`password-field ${className}`} style={wrapperStyle}>
            <input
                type={isVisible ? 'text' : 'password'}
                className="password-field-input"
                value={value}
                onChange={onChange}
                placeholder={placeholder}
                autoComplete={autoComplete}
                id={id}
                name={name}
                style={inputStyle}
                {...props}
            />
            <button
                type="button"
                className="password-toggle-btn"
                onClick={() => setIsVisible((prev) => !prev)}
                aria-label={isVisible ? 'Hide password' : 'Show password'}
            >
                <svg viewBox="0 0 24 24" aria-hidden="true" focusable="false" className="password-eye-icon">
                    <path
                        d="M2.2 12s3.6-6.2 9.8-6.2S21.8 12 21.8 12s-3.6 6.2-9.8 6.2S2.2 12 2.2 12Z"
                        fill="none"
                        stroke="currentColor"
                        strokeWidth="1.8"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                    />
                    <circle cx="12" cy="12" r="3" fill="none" stroke="currentColor" strokeWidth="1.8" />
                    {!isVisible && (
                        <path
                            d="M4 4l16 16"
                            fill="none"
                            stroke="currentColor"
                            strokeWidth="1.9"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    )}
                </svg>
            </button>
        </div>
    );
}
