using System.ComponentModel.DataAnnotations;
using EmployeeManagement.Models;

namespace EmployeeManagement.Tests;

public class EmployeeTests
{
    private static Employee ValidEmployee() => new()
    {
        FirstName = "Jane",
        LastName = "Doe",
        Email = "jane@pragimtech.com",
        DateOfBirth = new DateTime(1990, 1, 1),
        Gender = Gender.Female,
        DepartmentId = 1
    };

    private static List<ValidationResult> Validate(Employee employee)
    {
        var results = new List<ValidationResult>();
        Validator.TryValidateObject(employee, new ValidationContext(employee), results, validateAllProperties: true);
        return results;
    }

    private static bool HasErrorFor(List<ValidationResult> results, string member) =>
        results.Any(r => r.MemberNames.Contains(member));

    [Fact]
    public void Valid_employee_has_no_errors()
    {
        Assert.Empty(Validate(ValidEmployee()));
    }

    [Fact]
    public void Missing_first_name_is_reported_with_custom_message()
    {
        var employee = ValidEmployee();
        employee.FirstName = null!;

        var results = Validate(employee);

        Assert.Contains(results, r => r.ErrorMessage == "First Name must be provided");
    }

    [Fact]
    public void First_name_shorter_than_two_characters_is_invalid()
    {
        var employee = ValidEmployee();
        employee.FirstName = "J";

        Assert.True(HasErrorFor(Validate(employee), nameof(Employee.FirstName)));
    }

    [Fact]
    public void Missing_last_name_is_invalid()
    {
        var employee = ValidEmployee();
        employee.LastName = null!;

        Assert.True(HasErrorFor(Validate(employee), nameof(Employee.LastName)));
    }

    [Fact]
    public void Email_outside_allowed_domain_is_rejected_with_domain_message()
    {
        var employee = ValidEmployee();
        employee.Email = "jane@example.com";

        var results = Validate(employee);

        Assert.Contains(results, r => r.ErrorMessage == "You must use PragimTech.com as Domain");
    }

    [Fact]
    public void Malformed_email_is_invalid()
    {
        var employee = ValidEmployee();
        employee.Email = "not-an-email";

        Assert.True(HasErrorFor(Validate(employee), nameof(Employee.Email)));
    }
}
