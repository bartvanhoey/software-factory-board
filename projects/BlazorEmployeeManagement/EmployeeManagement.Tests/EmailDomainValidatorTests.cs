using System.ComponentModel.DataAnnotations;
using EmployeeManagement.Models.CustomValidators;

namespace EmployeeManagement.Tests;

public class EmailDomainValidatorTests
{
    private static ValidationResult? Validate(EmailDomainValidator validator, object? value)
    {
        var context = new ValidationContext(new object()) { MemberName = "Email" };
        return validator.GetValidationResult(value, context);
    }

    [Fact]
    public void Null_value_is_valid()
    {
        Assert.Equal(ValidationResult.Success, Validate(new EmailDomainValidator(), null));
    }

    [Theory]
    [InlineData("jane@pragimtech.com")]
    [InlineData("jane@PragimTech.com")]
    [InlineData("jane@PRAGIMTECH.COM")]
    public void Allowed_domain_is_valid_regardless_of_case(string email)
    {
        Assert.Equal(ValidationResult.Success, Validate(new EmailDomainValidator(), email));
    }

    [Theory]
    [InlineData("jane@example.com")]
    [InlineData("jane@sub.pragimtech.com")]
    [InlineData("not-an-email")]
    public void Other_domain_or_missing_at_sign_is_invalid(string email)
    {
        var validator = new EmailDomainValidator { ErrorMessage = "wrong domain" };

        var result = Validate(validator, email);

        Assert.NotEqual(ValidationResult.Success, result);
        Assert.Equal("wrong domain", result!.ErrorMessage);
        Assert.Contains("Email", result.MemberNames);
    }

    [Fact]
    public void AllowedDomain_can_be_overridden()
    {
        var validator = new EmailDomainValidator { AllowedDomain = "example.com", ErrorMessage = "wrong domain" };

        Assert.Equal(ValidationResult.Success, Validate(validator, "jane@example.com"));
        Assert.NotEqual(ValidationResult.Success, Validate(validator, "jane@pragimtech.com"));
    }
}
