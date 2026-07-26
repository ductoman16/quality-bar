const password = document.getElementById("password");
const loginForm = document.getElementById("login-form");

if (!(password instanceof HTMLInputElement)) {
  throw new Error("operator_browser_password_input_missing");
}
if (!(loginForm instanceof HTMLFormElement)) {
  throw new Error("operator_browser_login_form_missing");
}

password.value = "a correct operator password";
loginForm.requestSubmit();
