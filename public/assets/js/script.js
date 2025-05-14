// Wait for the DOM to be fully loaded before executing the script
document.addEventListener('DOMContentLoaded', function () {
  const form = document.getElementById('verificationForm');

  // Handle form submission
  form.addEventListener('submit', function (event) {
    // Prevent form submission to check validations
    event.preventDefault();

    // Grab form values
    const name = document.getElementById('u_name').value;
    const email = document.getElementById('u_email').value;
    const file = document.getElementById('u_file').files[0];

    // Validate the form fields
    if (!name || !email || !file) {
      alert('Please fill in all fields and upload a file.');
      return;
    }

    // Email validation (basic format check)
    const emailPattern = /^[a-zA-Z0-9._-]+@[a-zA-Z0-9.-]+\.[a-zA-Z]{2,6}$/;
    if (!emailPattern.test(email)) {
      alert('Please enter a valid email address.');
      return;
    }

    // Optional: File size validation (Max 5MB)
    const maxFileSize = 5 * 1024 * 1024; // 5MB in bytes
    if (file.size > maxFileSize) {
      alert('The file is too large. Maximum size is 5MB.');
      return;
    }

    // If all validation passes, submit the form (you can add a submit action here)
    alert('Form submitted successfully!');
    form.submit(); // Normally, you'd submit the form here, but it's blocked for validation
  });
});
