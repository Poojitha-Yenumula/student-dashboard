'use strict';

const $ = id => document.getElementById(id);
const SESSION_KEY = 'studyhub_session_v1';
const EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+$/;
let otpRequested = false;
let cooldownTimer = null;
let toastTimer;

const toast = (message, type = 'success') => {
  clearTimeout(toastTimer);
  $('toastMsg').textContent = message;
  const toastElement = $('toast');
  toastElement.className = `toast ${type} show`;
  toastTimer = setTimeout(() => toastElement.classList.remove('show'), 4200);
};

async function postJson(path, payload) {
  const response = await fetch(path, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    credentials: 'same-origin',
    body: JSON.stringify(payload)
  });
  let result;
  try {
    result = await response.json();
  } catch {
    throw new Error('The server returned an invalid response.');
  }
  if (!response.ok) {
    const error = new Error(result.error || 'The request could not be completed.');
    error.retryAfter = Number(result.retryAfter) || 0;
    throw error;
  }
  return result;
}

function savedNameFor(email) {
  try {
    const accounts = JSON.parse(localStorage.getItem('studyhub_users_v1') || '{}');
    const legacyName = accounts[email]?.name;
    const profile = JSON.parse(localStorage.getItem(`${email}_profile`) || '{}');
    return String(profile.name || legacyName || '').trim();
  } catch {
    return '';
  }
}

function setBusy(isBusy, label) {
  const button = $('otpSubmitBtn');
  button.disabled = isBusy;
  button.textContent = label;
}

function startResendCooldown(seconds = 60) {
  clearInterval(cooldownTimer);
  const button = $('resendOtpBtn');
  let remaining = seconds;
  button.disabled = true;
  button.classList.remove('hidden');
  const update = () => {
    button.textContent = remaining > 0 ? `Resend code in ${remaining}s` : 'Resend code';
    if (remaining <= 0) {
      button.disabled = false;
      clearInterval(cooldownTimer);
    }
    remaining -= 1;
  };
  update();
  cooldownTimer = setInterval(update, 1000);
}

async function requestCode() {
  const email = $('loginEmail').value.trim().toLowerCase();
  const name = $('loginName').value.trim() || savedNameFor(email) || email.split('@')[0];
  if (!EMAIL_PATTERN.test(email)) {
    toast('Enter a valid email address.', 'error');
    $('loginEmail').focus();
    return;
  }
  if (name.length > 80) {
    toast('Your name must be 80 characters or fewer.', 'error');
    return;
  }

  setBusy(true, 'Sending code…');
  try {
    await postJson('/api/auth/request-otp', { email, name });
    otpRequested = true;
    $('loginEmail').readOnly = true;
    $('loginName').readOnly = true;
    $('otpField').classList.remove('hidden');
    $('otpHelp').textContent = 'Check your inbox. The code expires in 10 minutes.';
    $('changeEmailBtn').classList.remove('hidden');
    $('otpCode').required = true;
    $('otpCode').focus();
    setBusy(false, 'Verify code and continue →');
    startResendCooldown();
    toast('Verification code sent. Check your email.', 'success');
  } catch (error) {
    setBusy(false, 'Send verification code →');
    toast(error.message, 'error');
  }
}

async function verifyCode() {
  const email = $('loginEmail').value.trim().toLowerCase();
  const code = $('otpCode').value.trim();
  if (!/^\d{6}$/.test(code)) {
    toast('Enter the six-digit code from your email.', 'error');
    $('otpCode').focus();
    return;
  }

  setBusy(true, 'Verifying…');
  try {
    const session = await postJson('/api/auth/verify-otp', { email, code });
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session));
    localStorage.removeItem(SESSION_KEY);
    localStorage.setItem(`${email}_profile`, JSON.stringify({ name: session.name }));
    localStorage.removeItem('isLoggedIn');
    localStorage.removeItem('userEmail');
    localStorage.removeItem('userName');
    toast('Email verified. Opening your workspace…', 'success');
    window.location.assign('Dashboard/dashboard.html');
  } catch (error) {
    setBusy(false, 'Verify code and continue →');
    toast(error.message, 'error');
  }
}

$('loginEl').addEventListener('submit', event => {
  event.preventDefault();
  if (otpRequested) {
    verifyCode();
  } else {
    requestCode();
  }
});

$('changeEmailBtn').addEventListener('click', () => {
  otpRequested = false;
  clearInterval(cooldownTimer);
  $('otpField').classList.add('hidden');
  $('changeEmailBtn').classList.add('hidden');
  $('resendOtpBtn').classList.add('hidden');
  $('otpCode').value = '';
  $('otpCode').required = false;
  $('loginEmail').readOnly = false;
  $('loginName').readOnly = false;
  $('otpHelp').textContent = 'New or returning? Verify your email to continue.';
  setBusy(false, 'Send verification code →');
  $('loginEmail').focus();
});

$('resendOtpBtn').addEventListener('click', async () => {
  const email = $('loginEmail').value.trim().toLowerCase();
  const name = $('loginName').value.trim() || savedNameFor(email) || email.split('@')[0];
  $('resendOtpBtn').disabled = true;
  try {
    await postJson('/api/auth/request-otp', { email, name });
    $('otpCode').value = '';
    startResendCooldown();
    toast('A new verification code was sent.', 'success');
  } catch (error) {
    if (error.retryAfter) startResendCooldown(error.retryAfter);
    else $('resendOtpBtn').disabled = false;
    toast(error.message, 'error');
  }
});

document.querySelectorAll('.iw input').forEach(input => {
  input.addEventListener('focus', () => input.closest('.field').style.transform = 'translateY(-1px)');
  input.addEventListener('blur', () => input.closest('.field').style.transform = '');
});
