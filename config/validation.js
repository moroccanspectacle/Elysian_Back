const Joi = require('@hapi/joi');

// Password validation schema
const passwordSchema = Joi.string()
  .min(8)
  .max(100)
  .pattern(new RegExp('^(?=.*[a-z])(?=.*[A-Z])(?=.*\\d)(?=.*[@$!%*?&])[A-Za-z\\d@$!%*?&]'))
  .required()
  .messages({
    'string.min': 'Password must be at least 8 characters long',
    'string.max': 'Password cannot exceed 100 characters',
    'string.pattern.base': 'Password must include at least one uppercase letter, one lowercase letter, one number, and one special character',
    'any.required': 'Password is required'
  });

const registerValidation = (data) => {
    const schema = Joi.object({
        username: Joi.string().min(6).required(),
        email: Joi.string().min(6).required().email(),
        password: passwordSchema
    });

    return schema.validate(data);
}

const loginValidation = (data) => {
    const schema = Joi.object({
        email: Joi.string().min(6).required().email(),
        password: Joi.string().min(6).required(),
        rememberMe: Joi.boolean().optional() // Add this line
    });
    return schema.validate(data);
}

const passwordResetValidation = (data) => {
    const schema = Joi.object({
        password: passwordSchema
    });
    return schema.validate(data);
}

const passwordChangeValidation = (data) => {
    const schema = Joi.object({
        currentPassword: Joi.string().required(),
        newPassword: passwordSchema
    });
    return schema.validate(data);
}

module.exports = {
    registerValidation,
    loginValidation,
    passwordResetValidation,
    passwordChangeValidation
};