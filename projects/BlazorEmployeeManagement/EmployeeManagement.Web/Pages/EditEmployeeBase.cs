
using System;
using System.Collections.Generic;
using System.Linq;
using System.Net;
using System.Threading.Tasks;
using AutoMapper;
using EmployeeManagement.Models;
using EmployeeManagement.Web.Models;
using EmployeeManagement.Web.Services;
using Microsoft.AspNetCore.Components;
using Microsoft.AspNetCore.Components.Authorization;
using PragimTech.Components;

namespace EmployeeManagement.Web.Pages
{
  public class EditEmployeeBase : ComponentBase
  {

    [CascadingParameter] public Task<AuthenticationState> AuthenticationStateTask { get; set; }
    [Inject] public IEmployeeService EmployeeService { get; set; }
    [Inject] public IDepartmentService DepartmentService { get; set; }
    [Inject] public IMapper Mapper { get; set; }
    [Inject] public NavigationManager NavigationManager { get; set; }
    public ConfirmBase DeleteConfirmation { get; set; }
    public List<Department> Departments { get; set; } = new List<Department>();
    private Employee Employee { get; set; } = new Employee();
    public EditEmployeeModel EditEmployeeModel { get; set; } = new EditEmployeeModel();
    [Parameter]
    public string Id { get; set; }

    public string PageHeader { get; set; }
    protected async override Task OnInitializedAsync()
    {
      var authenticationState = await AuthenticationStateTask;

      if (!authenticationState.User.Identity.IsAuthenticated) {
          var returnUrl = WebUtility.UrlEncode($"/editEmployee/{Id}");
          NavigationManager.NavigateTo($"/identity/account/login?returnUrl={returnUrl}");
      }

      int.TryParse(Id, out int employeeId);

      if (employeeId != 0)
      {
        PageHeader = "Edit Employee";
        Employee = await EmployeeService.GetEmployee(int.Parse(Id));
      }
      else
      {
        PageHeader = "Create Employee";
        Employee = new Employee
        {
          DepartmentId = 1,
          DateOfBirth = DateTime.Now,
          PhotoPath = "images/nophoto.jpg"
        };
      }

      Departments = (await DepartmentService.GetDepartments()).ToList();
      Mapper.Map(Employee, EditEmployeeModel);
    }

    protected async Task HandleValidSubmitAsync()
    {
      Mapper.Map(EditEmployeeModel, Employee);
      Employee result = null;
      if (Employee.EmployeeId != 0)
      {
        result = await EmployeeService.UpdateEmployee(Employee);
      }
      else
      {
        result = await EmployeeService.CreateEmployee(Employee);
      }

      if (result != null)
      {
        NavigationManager.NavigateTo("/");
      }
    }

    protected void Delete_Click() => DeleteConfirmation.Show();
    protected async Task ConfirmDelete_Click(bool value)
    {
      if (value == true)
      {
        await EmployeeService.DeleteEmployee(EditEmployeeModel.EmployeeId);
        NavigationManager.NavigateTo("/");
      }
    }
  }
}