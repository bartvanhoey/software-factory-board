using System;
using System.ComponentModel.DataAnnotations;
using EmployeeManagement.Models;
using EmployeeManagement.Models.CustomValidators;

namespace EmployeeManagement.Web.Models
{
    public class EditEmployeeModel
    {
        public int EmployeeId { get; set; }
        [Required(ErrorMessage = "First Name must be provided")]
        [MinLength(2)]
        public string FirstName { get; set; }
        [Required]
        public string LastName { get; set; }

        [EmailAddress]
        [EmailDomainValidator(AllowedDomain = "PragimTech.com", ErrorMessage = "You must use PragimTech.com as Domain")]
        public string Email { get; set; }

        [Compare(nameof(Email), ErrorMessage = "Email and Confirm Email must match")]
        public string ConfirmEmail { get; set; }
        public DateTime DateOfBirth { get; set; }
        public Gender Gender { get; set; }
        public int DepartmentId { get; set; }
        public string PhotoPath { get; set; }
        [ValidateComplexType]
        public Department Department { get; set; } = new Department();


    }
}