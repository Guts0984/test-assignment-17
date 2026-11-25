import { z } from 'zod';

/** Plain messages for what a person types wrong, instead of zod's technical ones ("Invalid uuid", "String must contain…"). */
export const friendlyErrorMap: z.ZodErrorMap = (issue, ctx) => {
  switch (issue.code) {
    case z.ZodIssueCode.invalid_type:
      return { message: issue.received === 'undefined' || issue.received === 'null' ? 'Required' : 'Enter a valid value' };
    case z.ZodIssueCode.invalid_string:
      if (issue.validation === 'email') return { message: 'Enter a valid e-mail address' };
      if (issue.validation === 'uuid') return { message: 'Choose an option' };
      return { message: 'Enter a valid value' };
    case z.ZodIssueCode.too_small:
      if (issue.type === 'string') return { message: issue.minimum === 1 ? 'Required' : `Enter at least ${String(issue.minimum)} characters` };
      if (issue.type === 'number') return { message: `Must be at least ${String(issue.minimum)}` };
      return { message: 'Too few items' };
    case z.ZodIssueCode.too_big:
      if (issue.type === 'string') return { message: `Enter at most ${String(issue.maximum)} characters` };
      if (issue.type === 'number') return { message: `Must be at most ${String(issue.maximum)}` };
      return { message: 'Too many items' };
    case z.ZodIssueCode.invalid_enum_value:
      return { message: 'Choose one of the listed options' };
    default:
      return { message: ctx.defaultError };
  }
};

z.setErrorMap(friendlyErrorMap);
