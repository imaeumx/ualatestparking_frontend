import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import axios from 'axios';
import { usePopup } from '../components/PopupContext';

/**
 * Login Page
 *
 * Responsibilities:
 * 1) Let existing users log in.
 * 2) Let new users register (student or non-student).
 * 3) Route users to the correct dashboard based on backend role.
 *
 * Notes for study:
 * - This component keeps both login and registration UI in one file.
 * - `isRegistering` works like a screen toggle.
 * - Backend remains the source of truth for role/authorization.
 */
export default function Login() {
    // Router helper for programmatic page navigation after login success.
    const navigate = useNavigate();

    // Global popup helpers from context for friendly error/success feedback.
    const { showError, showSuccess } = usePopup();

    // UI mode flag: false => show login form, true => show registration form.
    const [isRegistering, setIsRegistering] = useState(false);
    
    // Login/Register role tabs.
    // `loginRole` is only UI guidance (actual access still validated by backend role).
    const [loginRole, setLoginRole] = useState('user'); 

    // Registration role determines which extra fields are shown.
    // student => Student ID + level/specialization fields
    // guest   => Non-student reason field
    const [regRole, setRegRole] = useState('student');

    // Shared credential inputs used by both login and registration.
    const [username, setUsername] = useState('');
    const [password, setPassword] = useState('');
    
    // Registration profile fields.
    const [fName, setFName] = useState('');
    const [lName, setLName] = useState('');
    const [email, setEmail] = useState('');
    const [studentId, setStudentId] = useState('');
    const [level, setLevel] = useState('');
    const [subLevel, setSubLevel] = useState('');
    const [guestPurpose, setGuestPurpose] = useState('');

    // Static dropdown options for academic tracks/courses.
    const strands = ["STEM", "ABM", "HUMSS", "GAS", "TVL"];
    const courses = ["BSIT", "BSCS", "BSBA", "BSCrim", "BSHM", "BSA", "BSED"];

    // Non-student categories for registration.
    const nonStudentReasons = [
        'Parent/Guardian',
        'Service Personnel',
        'Visitor',
        'Delivery Rider',
        'Vendor/Supplier',
        'Alumni',
        'Event Participant',
        'Other'
    ];

    /**
     * Handle Enter key press for login form
     */
    const handleLoginKeyPress = (e) => {
        // Pressing Enter in username/password triggers login submit.
        if (e.key === 'Enter') {
            handleLogin();
        }
    };

    /**
     * Handle Enter key press for registration form
     */
    const handleRegisterKeyPress = (e) => {
        // Pressing Enter in registration password triggers register submit.
        if (e.key === 'Enter') {
            handleRegister();
        }
    };

    const handleLogin = async () => {
        // Unified login endpoint; backend decides if credentials are valid.
        try {
            // Trim values to avoid accidental spaces causing failed login attempts.
            const res = await axios.post('http://127.0.0.1:8000/api/login/', {
                username: username.trim(),
                password: password.trim() // Plain text sent over local/dev HTTP API.
            });

            if (res.data.status === 'success') {
                // Persist lightweight session in localStorage for later page reloads.
                const userSession = { 
                    username: res.data.user.username, 
                    role: res.data.user.role, 
                    firstName: res.data.user.first_name, 
                    lastName: res.data.user.last_name,
                    identifier: res.data.user.identifier,
                    authToken: res.data.user.auth_token || ''
                };
                localStorage.setItem('currentUser', JSON.stringify(userSession));

                // Normalize role text so comparison is case-insensitive.
                const normalizedRole = (res.data.user.role || '').toLowerCase();

                // Route personnel roles to personnel dashboard; others to user dashboard.
                if (['root_admin', 'admin', 'guard'].includes(normalizedRole)) {
                    navigate('/personnel');
                } else {
                    navigate('/user');
                }
            }
        } catch (err) {
            // Prefer server error message when available, fallback to friendly default.
            const msg = err.response?.data?.message || "Login failed: Incorrect credentials.";
            showError(msg);
        }
    };

    const handleRegister = async (e) => {
        // Supports both button click and form submission events.
        if (e) e.preventDefault();
        
        // Minimal required fields validation.
        if (!username || !password || !fName || !lName) {
            return showError("Please fill in all required fields.");
        }

        // Non-student accounts must declare their campus purpose.
        if (regRole !== 'student' && !guestPurpose) {
            return showError("Please select a reason for Non-Student account.");
        }

        // Build readable identifier text saved with the account.
        // Student example: "2023-12345 | College - BSIT"
        // Non-student example: "Visitor"
        let identifierText = regRole === 'student' 
            ? `${studentId} | ${level} - ${subLevel}` 
            : (guestPurpose || "Non-Student");

        // Payload expected by backend register endpoint.
        const newUser = {
            firstName: fName,
            lastName: lName,
            email: email,
            username: username.trim(),
            password: password.trim(), // Backend currently handles storage rules.
            identifier: identifierText,
            role: regRole
        };

        try {
            // Create user account in backend.
            const res = await axios.post('http://127.0.0.1:8000/api/register/', newUser);
            if (res.data.status === 'success') {
                showSuccess("Account created successfully! You can now Login.");

                // Switch UI back to login mode after successful registration.
                setIsRegistering(false);

                // Clear key input state for fresh login.
                setUsername(''); setPassword(''); setFName(''); setLName('');
            }
        } catch (err) {
            // Show backend message if provided.
            showError(err.response?.data?.message || "Registration failed.");
        }
    };

    return (
        // Centered auth card container.
        <div className="center">
            <div className="card">
                <h2 style={{ textAlign: 'center' }}>UA Parking System</h2>
                <p className="subtitle" style={{ textAlign: 'center' }}>Secure Vehicle & User Access</p>

                {!isRegistering ? (
                    // LOGIN VIEW
                    <div className="login-box">
                        <div className="panel">
                            <h3>Login As</h3>
                            <div className="role-tabs">
                                {/* UI-only role tab for user context; backend still validates actual role */}
                                <button className={`role-tab ${loginRole === 'user' ? 'active' : ''}`} onClick={() => setLoginRole('user')}>Student / Non-Student</button>
                                <button className={`role-tab ${loginRole === 'admin' ? 'active' : ''}`} onClick={() => setLoginRole('admin')}>Personnel</button>
                            </div>
                        </div>

                        <div className="panel">
                            <h3>Credentials</h3>
                            <input 
                                type="text" 
                                placeholder="Username" 
                                value={username} 
                                onChange={(e) => setUsername(e.target.value)}
                                onKeyDown={handleLoginKeyPress}
                            />
                            <input 
                                type="password" 
                                placeholder="Password" 
                                value={password} 
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={handleLoginKeyPress}
                            />
                            <button className="btn-blue" onClick={handleLogin} style={{ width: '100%', marginTop: '10px' }}>Login to Portal</button>
                            <p className="auth-switch" style={{ textAlign: 'center', marginTop: '15px' }}>
                                {/* Switch to registration mode */}
                                New here? <button className="link-btn" onClick={() => setIsRegistering(true)}>Register</button>
                            </p>
                        </div>
                    </div>
                ) : (
                    // REGISTRATION VIEW
                    <div className="register-box">
                        <div className="panel">
                            <h3>Create Account</h3>
                            <div className="role-tabs">
                                {/* Role toggle changes which extra fields appear below */}
                                <button className={`role-tab ${regRole === 'student' ? 'active' : ''}`} onClick={() => setRegRole('student')}>Student</button>
                                <button className={`role-tab ${regRole === 'guest' ? 'active' : ''}`} onClick={() => setRegRole('guest')}>Non-Student</button>
                            </div>

                            <div className="action-grid" style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px', marginTop: '15px' }}>
                                <input type="text" placeholder="First Name" value={fName} onChange={(e) => setFName(e.target.value)} />
                                <input type="text" placeholder="Last Name" value={lName} onChange={(e) => setLName(e.target.value)} />
                            </div>

                            <div style={{ marginTop: '10px' }}>
                                {regRole === 'student' ? (
                                    <div className="student-info" style={{ display: 'flex', flexDirection: 'column', gap: '10px' }}>
                                        {/* Student-only identity fields */}
                                        <input type="text" placeholder="Student ID" value={studentId} onChange={(e) => setStudentId(e.target.value)} />
                                        <select value={level} onChange={(e) => setLevel(e.target.value)}>
                                            <option value="">Select Level</option>
                                            <option value="Senior High">Senior High</option>
                                            <option value="College">College</option>
                                        </select>
                                        {level && (
                                            // Specialization list switches by selected level.
                                            <select value={subLevel} onChange={(e) => setSubLevel(e.target.value)}>
                                                <option value="">Select Specialization</option>
                                                {(level === 'Senior High' ? strands : courses).map(item => (
                                                    <option key={item} value={item}>{item}</option>
                                                ))}
                                            </select>
                                        )}
                                    </div>
                                ) : (
                                    // Non-student-only reason dropdown.
                                    <select value={guestPurpose} onChange={(e) => setGuestPurpose(e.target.value)}>
                                        <option value="">Select Reason</option>
                                        {nonStudentReasons.map(reason => (
                                            <option key={reason} value={reason}>{reason}</option>
                                        ))}
                                    </select>
                                )}
                            </div>

                            <input type="email" placeholder="Email" value={email} style={{ marginTop: '10px' }} onChange={(e) => setEmail(e.target.value)} />
                            <input type="text" placeholder="Username" value={username} style={{ marginTop: '10px' }} onChange={(e) => setUsername(e.target.value)} />
                            <input 
                                type="password" 
                                placeholder="Password" 
                                value={password} 
                                style={{ marginTop: '10px' }} 
                                onChange={(e) => setPassword(e.target.value)}
                                onKeyDown={handleRegisterKeyPress}
                            />
                            
                            <button className="btn-green" onClick={handleRegister} style={{ width: '100%', marginTop: '20px' }}>Create Account</button>
                            <p className="auth-switch" style={{ textAlign: 'center', marginTop: '15px' }}>
                                {/* Switch back to login mode */}
                                Have an account? <button className="link-btn" onClick={() => setIsRegistering(false)}>Login</button>
                            </p>
                        </div>
                    </div>
                )}
            </div>
        </div>
    );
}