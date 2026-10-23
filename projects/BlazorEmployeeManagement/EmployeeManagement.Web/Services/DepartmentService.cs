using System.Collections.Generic;
using System.Net.Http;
using System.Threading.Tasks;
using EmployeeManagement.Models;
using System.Net.Http.Json;

namespace EmployeeManagement.Web.Services
{
    public class DepartmentService : IDepartmentService
    {
        private readonly HttpClient httpClient;

        public DepartmentService(HttpClient httpClient)
        {
            this.httpClient = httpClient;
        }

        public async Task<Department> GetDepartment(int id)
        {
            return await httpClient.GetFromJsonAsync<Department>($"api/departments/{id}");
        }


        public async Task<IEnumerable<Department>> GetDepartments()
        {   
            var departments = await httpClient.GetFromJsonAsync<Department[]>($"api/departments");
            return departments;
        }
    }
}