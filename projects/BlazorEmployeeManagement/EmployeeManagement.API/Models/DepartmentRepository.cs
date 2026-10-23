using EmployeeManagement.Models;
using System.Collections.Generic;
using EmployeeManagement.API.Models;
using System.Threading.Tasks;
using Microsoft.EntityFrameworkCore;

namespace EmployeeManagement.Api.Models
{
    public class DepartmentRepository : IDepartmentRepository
    {
        private readonly AppDbContext _dbContext;

        public DepartmentRepository(AppDbContext appDbContext)
        {
            _dbContext = appDbContext;
        }

        public async Task<Department> GetDepartment(int departmentId)
        {
            return await _dbContext.Departments
                .FirstOrDefaultAsync(d => d.DepartmentId == departmentId);
        }

        public async Task<IEnumerable<Department>> GetDepartments()
        {
            return await _dbContext.Departments.ToListAsync();
        }
    }
}